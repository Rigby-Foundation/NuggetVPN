package remote

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// emptySubscription explains a subscription that answered but lists no
// server the app can use.
//
// A provider whose plan has run out usually still answers, with placeholder
// entries in place of servers: a link to 0.0.0.0 or 127.0.0.1 with an
// all-zero id, named with the message meant for the user ("Subscription
// expired", "Renew at …"). Those entries are dropped as unusable, and the
// error used to quote the response body instead, which for most providers is
// base64 and says nothing to anyone. The expiry date and the placeholders'
// names do.
func emptySubscription(domain, body string, headers http.Header, now time.Time) error {
	var parts []string
	if info := ParseSubscriptionInfo(headers, now); info != nil && info.Expire > 0 && info.Expire <= now.Unix() {
		parts = append(parts, fmt.Sprintf("the subscription expired on %s", time.Unix(info.Expire, 0).Format("Jan 2, 2006")))
	}
	if notes := placeholderNotes(body); len(notes) > 0 {
		parts = append(parts, fmt.Sprintf("the provider says: %s", strings.Join(notes, " · ")))
	}
	if len(parts) > 0 {
		return fmt.Errorf("%s lists no servers right now: %s", domain, strings.Join(parts, "; "))
	}
	return fmt.Errorf("subscription %q returned no supported links. Response preview: %s",
		domain, preview(decodeSubscriptionBody(body), 160))
}

// placeholderNotes are the names of a subscription's placeholder entries,
// where providers put their message; at most three, without repeats.
func placeholderNotes(body string) []string {
	var notes []string
	seen := map[string]bool{}
	for _, line := range strings.Split(decodeSubscriptionBody(body), "\n") {
		line = strings.TrimSpace(line)
		if !isPlaceholder(line) {
			continue
		}
		_, fragment, found := strings.Cut(line, "#")
		if !found {
			continue
		}
		note := fragment
		if unescaped, err := url.PathUnescape(fragment); err == nil {
			note = unescaped
		}
		note = strings.TrimSpace(note)
		if note == "" || seen[note] {
			continue
		}
		seen[note] = true
		notes = append(notes, note)
		if len(notes) == 3 {
			break
		}
	}
	return notes
}

// isPlaceholder reports a link that stands in for a server rather than
// being one: nowhere to connect to, or an id no server accepts.
func isPlaceholder(link string) bool {
	return strings.Contains(link, "@127.0.0.1:") ||
		strings.Contains(link, "@0.0.0.0:") ||
		strings.Contains(link, "00000000-0000-0000-0000-000000000000")
}

// separatorWords are what panels describe a separator entry as, in the
// base64 serverDescription Remnawave appends to its name.
var separatorWords = []string{"разделитель", "separator", "divider", "розділювач"}

// dividerMarks draw a name as a divider rather than a message.
const dividerMarks = "⬇⬆↓↑▼▲▽△—–─━═=-|·•*~_ \t\uFE0F"

// separatorName reads a placeholder entry as a section heading: its name,
// without the divider drawn around it ("⬇️ — WiFi — ⬇️" is "WiFi"). It is
// a separator when Remnawave says so in its serverDescription, or when its
// name is drawn as a divider; anything else is a message, not a heading.
func separatorName(line string) (string, bool) {
	_, fragment, found := strings.Cut(line, "#")
	if !found {
		return "", false
	}
	name := fragment
	if unescaped, err := url.PathUnescape(fragment); err == nil {
		name = unescaped
	}
	marked := false
	if before, description, ok := strings.Cut(name, "?serverDescription="); ok {
		name = before
		if text := decodeText("base64:"+description, 200); text != "" {
			lower := strings.ToLower(text)
			for _, word := range separatorWords {
				if strings.Contains(lower, word) {
					marked = true
				}
			}
		}
	}
	trimmed := strings.Trim(name, dividerMarks)
	if trimmed == "" {
		return "", false
	}
	if !marked && trimmed == strings.TrimSpace(name) {
		// No divider drawn around it, and nothing says it is one.
		return "", false
	}
	if len([]rune(trimmed)) > 60 {
		trimmed = string([]rune(trimmed)[:60])
	}
	return trimmed, true
}
