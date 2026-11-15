import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EntryEditor,
  SOURCE_META,
  validDnsAddress,
} from "@/components/routing/nodes";
import { useT, type MessageKey } from "@/lib/i18n";
import { RULE_GUIDE } from "@/components/routing/guide";
import { errorMessage, invoke } from "@/lib/backend";
import { hasNativeRuntime, isIOS } from "@/lib/platform";
import type { RoutingCondition, RoutingRule, RoutingSource } from "@/types";

type DomainMode = "domain" | "exact" | "subdomains" | "regex" | "advanced";
const modes = [
  { id: "domain", title: "routing.ui.domain" },
  { id: "exact", title: "routing.ui.exact" },
  { id: "subdomains", title: "routing.ui.subdomains" },
  { id: "regex", title: "routing.source.regex.hint" },
  { id: "advanced", title: "routing.ui.advancedEntries" },
] as const satisfies readonly { id: DomainMode; title: MessageKey }[];
function modeFor(kind: string, values: string[]): DomainMode {
  if (kind === "domain_regex") return "regex";
  if (!values.length) return "domain";
  if (values.every((value) => value.startsWith("full:"))) return "exact";
  if (values.every((value) => value.startsWith("*.") || value.startsWith(".")))
    return "subdomains";
  return values.every((value) => {
    const domain = value.replace(/^(?:domain:|\+\.)/, "");
    return !domain.includes(":") && !/^(?:\*\.|\.)/.test(domain);
  })
    ? "domain"
    : "advanced";
}
function bare(value: string) {
  return value.replace(/^(?:full:|domain:|\*\.|\+\.|\.)/, "");
}
function quoteRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function readValues(mode: DomainMode, text: string) {
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) =>
      mode === "exact"
        ? `full:${value}`
        : mode === "subdomains"
          ? `*.${value}`
          : value,
    );
}

function DomainFields({
  kind,
  values,
  onChange,
}: {
  kind: "domains" | "domain_regex";
  values: string[];
  onChange: (patch: {
    kind: "domains" | "domain_regex";
    values: string[];
  }) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<DomainMode>(() => modeFor(kind, values));
  const [text, setText] = useState(() =>
    values
      .map((value) =>
        modeFor(kind, values) === "advanced" || kind === "domain_regex"
          ? value
          : bare(value),
      )
      .join("\n"),
  );
  useEffect(() => {
    setMode((previous) =>
      kind === "domain_regex"
        ? "regex"
        : values.length
          ? modeFor(kind, values)
          : previous === "regex"
            ? "domain"
            : previous,
    );
    setText(
      values
        .map((value) =>
          kind === "domain_regex" || modeFor(kind, values) === "advanced"
            ? value
            : bare(value),
        )
        .join("\n"),
    );
  }, [kind, values]);
  const [pendingMode, setPendingMode] = useState<DomainMode | null>(null);
  const [hostname, setHostname] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    matched: boolean;
    pattern?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const testRequest = useRef(0);
  const resetTest = () => {
    testRequest.current++;
    setTesting(false);
    setResult(null);
    setError("");
  };
  const commit = (nextMode: DomainMode, nextText: string) => {
    setMode(nextMode);
    setText(nextText);
    resetTest();
    onChange({
      kind: nextMode === "regex" ? "domain_regex" : "domains",
      values: readValues(nextMode, nextText),
    });
  };
  const changeMode = (next: DomainMode) => {
    if (next === mode) return;
    if ((mode === "regex" || mode === "advanced") && text.trim()) {
      setPendingMode(next);
      return;
    }
    let nextText = text;
    if (next === "regex")
      nextText = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map(
          (value) =>
            `${mode === "exact" ? "^" : mode === "subdomains" ? "^.+\\." : "(^|\\.)"}${quoteRegex(value.trim())}$`,
        )
        .join("\n");
    commit(next, nextText);
  };
  const test = async () => {
    if (!hostname.trim() || !text.trim() || testing) return;
    const request = ++testRequest.current;
    setTesting(true);
    setResult(null);
    setError("");
    try {
      if (!hasNativeRuntime()) throw new Error(t("routing.ui.testApp"));
      const preview = await invoke<{ matched: boolean; pattern?: string }>(
        "preview_domain_match",
        {
          kind: mode === "regex" ? "domain_regex" : "domains",
          values: readValues(mode, text),
          hostname,
        },
      );
      if (request === testRequest.current) setResult(preview);
    } catch (cause) {
      if (request === testRequest.current) setError(errorMessage(cause));
    } finally {
      if (request === testRequest.current) setTesting(false);
    }
  };
  const help: Record<DomainMode, MessageKey> = {
    domain: "routing.ui.domainHint",
    exact: "routing.ui.exactHint",
    subdomains: "routing.ui.subdomainsHint",
    regex: "routing.ui.regexHint",
    advanced: "routing.ui.selectors",
  };
  return (
    <div className="space-y-2">
      <Select<DomainMode>
        value={mode}
        onValueChange={(value) => value && changeMode(value)}
      >
        <SelectTrigger
          size="sm"
          className="w-full text-xs"
          aria-label={t("routing.ui.domainMode")}
        >
          <SelectValue>
            {t(modes.find((option) => option.id === mode)!.title)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {modes
            .filter((option) => option.id !== "advanced" || mode === "advanced")
            .map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {t(option.title)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {pendingMode && (
        <div
          role="alert"
          className="space-y-2 rounded-lg bg-muted/50 p-2 text-[11px]"
        >
          <p>{t("routing.ui.clearPrompt")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                commit(pendingMode, "");
                setPendingMode(null);
              }}
            >
              {t("routing.ui.clearSwitch")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingMode(null)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      <EntryEditor
        kind={mode === "regex" ? "domain_regex" : "domains"}
        values={
          mode === "advanced" || mode === "regex" ? values : values.map(bare)
        }
        onChange={(next) => commit(mode, next.join("\n"))}
      />
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer py-1">
          {t("routing.ui.tryHost")}
        </summary>
        <p className="my-2 leading-relaxed">{t(help[mode])}</p>
        <div className="flex gap-1.5">
          <Input
            value={hostname}
            onChange={(event) => {
              setHostname(event.target.value);
              resetTest();
            }}
            placeholder="ads.example.com"
            aria-label={t("routing.ui.tryHost")}
            className="h-8 min-w-0 text-xs!"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void test();
              }
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!hostname.trim() || !text.trim() || testing}
            onClick={() => void test()}
          >
            {testing ? t("ui.testing") : t("proxies.bulk.test")}
          </Button>
        </div>
        {result && (
          <p role="status" className="mt-2">
            {result.matched
              ? t("routing.ui.matches")
              : t("routing.ui.doesntMatch")}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
      </details>
    </div>
  );
}

function LogicalFields({
  rule,
  onChange,
}: {
  rule: RoutingRule;
  onChange: (patch: Partial<RoutingRule>) => void;
}) {
  const t = useT();
  const [conditions, setConditions] = useState(() =>
    (rule.conditions ?? []).map((condition) => ({
      ...condition,
      key: crypto.randomUUID(),
    })),
  );
  useEffect(() => {
    setConditions((previous) =>
      (rule.conditions ?? []).map((condition, index) => ({
        ...condition,
        key: previous[index]?.key ?? crypto.randomUUID(),
      })),
    );
  }, [rule.conditions]);
  const update = (next: typeof conditions) => {
    setConditions(next);
    onChange({ conditions: next.map(({ key: _, ...condition }) => condition) });
  };
  const patch = (index: number, next: Partial<RoutingCondition>) =>
    update(
      conditions.map((condition, position) =>
        position === index ? { ...condition, ...next } : condition,
      ),
    );
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-xs font-medium">
          {t("routing.logical.mode")}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(["and", "or"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              aria-pressed={(rule.mode ?? "and") === mode}
              onClick={() => onChange({ mode })}
              className={`rounded-xl border px-3 py-2 text-xs ${rule.mode === mode ? "border-primary/60 bg-primary/10" : "border-border/60"}`}
            >
              {mode === "and"
                ? t("routing.logical.all")
                : t("routing.logical.any")}
            </button>
          ))}
        </div>
      </fieldset>
      {conditions.map((condition, index) => (
        <section
          key={condition.key}
          className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-3"
        >
          <div className="flex gap-2">
            <Select<RoutingSource>
              value={condition.kind}
              onValueChange={(kind) => {
                if (kind !== null && kind !== condition.kind)
                  patch(index, { kind, values: [] });
              }}
            >
              <SelectTrigger
                aria-label={t("routing.ui.conditionLabel", {
                  index: index + 1,
                })}
                className="h-9! w-0 min-w-0 flex-1 text-xs"
              >
                <SelectValue>{t(RULE_GUIDE[condition.kind].title)}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {(Object.keys(SOURCE_META) as RoutingSource[]).filter((kind) => !isIOS || kind !== "apps").map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(RULE_GUIDE[kind].title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("routing.remove", {
                name: t("routing.ui.conditionLabel", { index: index + 1 }),
              })}
              onClick={() =>
                update(conditions.filter((item) => item.key !== condition.key))
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(RULE_GUIDE[condition.kind].description)}
          </p>
          {condition.kind === "domains" || condition.kind === "domain_regex" ? (
            <DomainFields
              key={`${condition.key}-${condition.kind === "domain_regex" ? "pattern" : "name"}`}
              kind={condition.kind}
              values={condition.values}
              onChange={(next) => patch(index, next)}
            />
          ) : (
            <EntryEditor
              key={condition.kind}
              kind={condition.kind}
              values={condition.values}
              onChange={(values) => patch(index, { values })}
            />
          )}
          <button
            type="button"
            aria-pressed={!!condition.invert}
            onClick={() => patch(index, { invert: !condition.invert })}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            {t(condition.invert ? "routing.invert" : "routing.only")}
          </button>
        </section>
      ))}
      <Button
        type="button"
        variant="outline"
        className="w-full rounded-xl"
        onClick={() =>
          update([
            ...conditions,
            { key: crypto.randomUUID(), kind: "domains", values: [] },
          ])
        }
      >
        <Plus className="size-3.5" />
        {t("routing.logical.addCondition")}
      </Button>
    </div>
  );
}

export function InlineRuleFields({
  rule,
  onChange,
}: {
  rule: RoutingRule;
  onChange: (patch: Partial<RoutingRule>) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(rule);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const current = useRef(rule);
  const save = useRef(onChange);
  save.current = onChange;

  useEffect(() => {
    current.current = rule;
    setDraft(rule);
    setError("");
    revision.current++;
  }, [
    rule.kind,
    rule.values,
    rule.conditions,
    rule.mode,
    rule.invert,
    rule.dns,
  ]);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );

  const update = async (patch: Partial<RoutingRule>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    setError("");
    const request = ++revision.current;
    try {
      if (next.dns && !validDnsAddress(next.dns))
        throw new Error(t("routing.dns.invalid"));
      const conditions =
        next.kind === "logical"
          ? (next.conditions ?? [])
          : [{ kind: next.kind, values: next.values }];
      if (hasNativeRuntime()) {
        for (const condition of conditions) {
          if (!condition.values.length) continue;
          await invoke("validate_routing_rule", {
            rule: { ...next, ...condition },
          });
        }
      }
      if (request === revision.current) {
        save.current({
          kind: next.kind,
          values: next.values,
          mode: next.mode,
          conditions: next.conditions,
          invert: next.invert,
          dns: next.dns,
        });
      }
    } catch (cause) {
      if (request === revision.current) setError(errorMessage(cause));
    }
  };

  return (
    <div className="nodrag nopan nowheel space-y-3 px-4 pb-4">
      <div className="flex rounded-full bg-muted/65 p-1">
        {[false, true].map((invert) => (
          <button
            key={String(invert)}
            type="button"
            aria-pressed={!!draft.invert === invert}
            onClick={() => void update({ invert })}
            title={invert ? t("routing.invert.hint") : undefined}
            className={`flex-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition-colors ${!!draft.invert === invert ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t(invert ? "routing.invert" : "routing.only")}
          </button>
        ))}
      </div>
      {draft.kind === "domains" || draft.kind === "domain_regex" ? (
        <DomainFields
          key={rule.id}
          kind={draft.kind}
          values={draft.values}
          onChange={(patch) => void update(patch)}
        />
      ) : draft.kind === "logical" ? (
        <LogicalFields rule={draft} onChange={(patch) => void update(patch)} />
      ) : (
        <EntryEditor
          kind={draft.kind}
          values={draft.values}
          onChange={(values) => void update({ values })}
        />
      )}
      {((draft.kind === "domains" && !draft.invert) || draft.dns) && (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer py-1">
              {t("routing.ui.customDns")}
            </summary>
            <Input
              aria-label={t("routing.ui.customDns")}
              defaultValue={draft.dns ?? ""}
              key={rule.dns ?? ""}
              placeholder="https://dns.google/dns-query"
              className="mt-2 h-8 text-xs!"
              onBlur={(event) => {
                if (event.target.value !== (current.current.dns ?? ""))
                  void update({ dns: event.target.value });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <p className="mt-2 leading-relaxed">{t("routing.dns.hint")}</p>
          </details>
        )}
      {error && (
        <p
          role="alert"
          className="break-words text-[11px] leading-relaxed text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
