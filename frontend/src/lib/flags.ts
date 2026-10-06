/**
 * Which country a server is in, read from its name.
 *
 * Providers name servers for people, not machines: "🇩🇪 Germany",
 * "Германия", "NL-2 [Amsterdam]". Nothing in a share link says where a
 * server is, so the name is all there is to go on. It is read, in order of
 * how sure it is: a flag emoji, then a country or city name, then a bare
 * ISO code in capitals.
 *
 * The flags themselves are drawn from bundled SVGs, not the emoji: Windows
 * has no flag emoji and shows two letters instead.
 */

/** Square flags, one file each, fetched only when shown. */
const FLAG_URLS = import.meta.glob<string>("/node_modules/flag-icons/flags/1x1/*.svg", {
    query: "?url&no-inline",
    import: "default",
    eager: true,
});

const flagUrls = new Map<string, string>();
for (const [path, url] of Object.entries(FLAG_URLS)) {
    const code = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
    flagUrls.set(code, url);
}

/** The flag picture for an ISO 3166 code, lower-case; undefined when none. */
export function flagUrl(code: string): string | undefined {
    return flagUrls.get(code.toLowerCase());
}

/**
 * Country and city names, in English, Russian and Ukrainian, as server lists
 * write them. Only the forms used as labels — the nominative — since that is
 * what a name in a list is.
 */
const NAMES: Record<string, string[]> = {
    al: ["Albania", "Албания", "Албанія", "Tirana"],
    am: ["Armenia", "Армения", "Вірменія", "Yerevan", "Ереван"],
    ar: ["Argentina", "Аргентина", "Buenos Aires"],
    at: ["Austria", "Австрия", "Австрія", "Vienna", "Вена", "Відень"],
    au: ["Australia", "Австралия", "Австралія", "Sydney", "Melbourne", "Сидней"],
    az: ["Azerbaijan", "Азербайджан", "Baku", "Баку"],
    be: ["Belgium", "Бельгия", "Бельгія", "Brussels", "Брюссель"],
    bg: ["Bulgaria", "Болгария", "Болгарія", "Sofia", "София"],
    br: ["Brazil", "Бразилия", "Бразилія", "São Paulo", "Sao Paulo"],
    by: ["Belarus", "Беларусь", "Білорусь", "Minsk", "Минск"],
    ca: ["Canada", "Канада", "Toronto", "Montreal", "Vancouver", "Торонто"],
    ch: ["Switzerland", "Швейцария", "Швейцарія", "Zurich", "Zürich", "Geneva", "Цюрих"],
    cl: ["Chile", "Чили", "Santiago"],
    cn: ["China", "Китай", "Shanghai", "Beijing"],
    co: ["Colombia", "Колумбия", "Bogota"],
    cy: ["Cyprus", "Кипр", "Кіпр", "Limassol", "Nicosia"],
    cz: ["Czechia", "Czech Republic", "Чехия", "Чехія", "Prague", "Прага"],
    de: ["Germany", "Германия", "Німеччина", "Deutschland", "Frankfurt", "Berlin", "Munich", "Nuremberg", "Falkenstein", "Франкфурт", "Берлин", "Мюнхен"],
    dk: ["Denmark", "Дания", "Данія", "Copenhagen", "Копенгаген"],
    ee: ["Estonia", "Эстония", "Естонія", "Tallinn", "Таллин"],
    eg: ["Egypt", "Египет", "Єгипет", "Cairo"],
    es: ["Spain", "Испания", "Іспанія", "Madrid", "Barcelona", "Мадрид"],
    fi: ["Finland", "Финляндия", "Фінляндія", "Helsinki", "Хельсинки", "Гельсінкі"],
    fr: ["France", "Франция", "Франція", "Paris", "Париж", "Marseille", "Gravelines", "Roubaix"],
    gb: ["United Kingdom", "UK", "Great Britain", "England", "Великобритания", "Велика Британія", "Британия", "Англия", "Англія", "London", "Лондон", "Manchester"],
    ge: ["Georgia", "Грузия", "Грузія", "Tbilisi", "Тбилиси"],
    gr: ["Greece", "Греция", "Греція", "Athens", "Афины"],
    hk: ["Hong Kong", "Гонконг"],
    hr: ["Croatia", "Хорватия", "Хорватія", "Zagreb"],
    hu: ["Hungary", "Венгрия", "Угорщина", "Budapest", "Будапешт"],
    id: ["Indonesia", "Индонезия", "Індонезія", "Jakarta"],
    ie: ["Ireland", "Ирландия", "Ірландія", "Dublin", "Дублин"],
    il: ["Israel", "Израиль", "Ізраїль", "Tel Aviv"],
    in: ["India", "Индия", "Індія", "Mumbai", "Bangalore", "Delhi"],
    ir: ["Iran", "Иран", "Іран", "Tehran"],
    is: ["Iceland", "Исландия", "Ісландія", "Reykjavik"],
    it: ["Italy", "Италия", "Італія", "Milan", "Rome", "Милан", "Рим"],
    jp: ["Japan", "Япония", "Японія", "Tokyo", "Osaka", "Токио"],
    kg: ["Kyrgyzstan", "Киргизия", "Кыргызстан", "Киргизстан", "Bishkek"],
    kr: ["South Korea", "Korea", "Южная Корея", "Корея", "Південна Корея", "Seoul", "Сеул"],
    kz: ["Kazakhstan", "Казахстан", "Almaty", "Astana", "Алматы", "Астана"],
    lt: ["Lithuania", "Литва", "Vilnius", "Вильнюс"],
    lu: ["Luxembourg", "Люксембург"],
    lv: ["Latvia", "Латвия", "Латвія", "Riga", "Рига"],
    md: ["Moldova", "Молдова", "Молдавия", "Chisinau", "Кишинёв"],
    mn: ["Mongolia", "Монголия", "Монголія"],
    mx: ["Mexico", "Мексика", "Мексика"],
    my: ["Malaysia", "Малайзия", "Малайзія", "Kuala Lumpur"],
    ng: ["Nigeria", "Нигерия", "Lagos"],
    nl: ["Netherlands", "The Netherlands", "Holland", "Нидерланды", "Нідерланди", "Голландия", "Amsterdam", "Амстердам", "Rotterdam"],
    no: ["Norway", "Норвегия", "Норвегія", "Oslo", "Осло"],
    nz: ["New Zealand", "Новая Зеландия", "Нова Зеландія", "Auckland"],
    ph: ["Philippines", "Филиппины", "Філіппіни", "Manila"],
    pk: ["Pakistan", "Пакистан", "Karachi"],
    pl: ["Poland", "Польша", "Польща", "Warsaw", "Варшава"],
    pt: ["Portugal", "Португалия", "Португалія", "Lisbon", "Лиссабон"],
    qa: ["Qatar", "Катар", "Doha"],
    ro: ["Romania", "Румыния", "Румунія", "Bucharest", "Бухарест"],
    rs: ["Serbia", "Сербия", "Сербія", "Belgrade", "Белград"],
    ru: ["Russia", "Россия", "Росія", "Moscow", "Москва", "Saint Petersburg", "St. Petersburg", "Санкт-Петербург", "Петербург"],
    sa: ["Saudi Arabia", "Саудовская Аравия", "Riyadh"],
    se: ["Sweden", "Швеция", "Швеція", "Stockholm", "Стокгольм"],
    sg: ["Singapore", "Сингапур", "Сінгапур"],
    si: ["Slovenia", "Словения", "Словенія", "Ljubljana"],
    sk: ["Slovakia", "Словакия", "Словаччина", "Bratislava"],
    th: ["Thailand", "Таиланд", "Таїланд", "Bangkok"],
    tj: ["Tajikistan", "Таджикистан", "Dushanbe"],
    tr: ["Turkey", "Türkiye", "Турция", "Туреччина", "Istanbul", "Стамбул"],
    tw: ["Taiwan", "Тайвань", "Taipei"],
    ua: ["Ukraine", "Украина", "Україна", "Kyiv", "Kiev", "Киев", "Київ"],
    ae: ["United Arab Emirates", "UAE", "ОАЭ", "ОАЕ", "Dubai", "Дубай"],
    us: ["United States", "USA", "США", "America", "Америка", "New York", "Нью-Йорк", "Los Angeles", "Лос-Анджелес", "Chicago", "Dallas", "Miami", "Seattle", "San Jose", "Silicon Valley", "Ashburn", "Atlanta"],
    uz: ["Uzbekistan", "Узбекистан", "Tashkent", "Ташкент"],
    vn: ["Vietnam", "Вьетнам", "В'єтнам", "Hanoi"],
    za: ["South Africa", "ЮАР", "Johannesburg"],
};

/** Every name, longest first, so "South Korea" wins over "Korea". */
const NAME_PATTERNS: { code: string; pattern: RegExp }[] = Object.entries(NAMES)
    .flatMap(([code, names]) => names.map((name) => ({ code, name })))
    .sort((a, b) => b.name.length - a.name.length)
    .map(({ code, name }) => ({
        code,
        // Letters on either side mean it is part of another word. Plain \b
        // only knows Latin letters, so it would never match "Германия".
        pattern: new RegExp(
            `(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`,
            // The few short Latin abbreviations stay case-sensitive, so "uk"
            // or "usa" inside ordinary words do not count.
            name.length <= 3 ? "u" : "iu"
        ),
    }));

/** A flag emoji: two regional indicator letters. */
const EMOJI_FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u;

/** A bare ISO code in capitals, standing alone: "DE", "[NL]", "FI-2". */
const ISO_CODE = /(?<![\p{L}])([A-Z]{2})(?![\p{L}])/gu;

function fromEmoji(name: string): string | null {
    const match = EMOJI_FLAG.exec(name);
    if (!match) return null;
    const letter = (char: string) => String.fromCharCode(char.codePointAt(0)! - 0x1f1e6 + 97);
    return letter(match[1]) + letter(match[2]);
}

/**
 * The country a server's name points to, as a lower-case ISO code with a
 * flag to show; null when the name says nothing about it.
 */
export function countryOf(name: string): string | null {
    const emoji = fromEmoji(name);
    if (emoji && flagUrls.has(emoji)) return emoji;

    for (const { code, pattern } of NAME_PATTERNS) {
        if (pattern.test(name)) return code;
    }

    for (const match of name.matchAll(ISO_CODE)) {
        const code = match[1].toLowerCase();
        if (flagUrls.has(code)) return code;
    }
    return null;
}

/**
 * The name with its flag emoji taken out, for showing beside a drawn flag:
 * otherwise the flag appears twice, and on Windows the emoji is two letters.
 */
export function withoutFlagEmoji(name: string): string {
    return name.replace(new RegExp(EMOJI_FLAG.source, "gu"), "").replace(/\s{2,}/g, " ").trim() || name;
}
