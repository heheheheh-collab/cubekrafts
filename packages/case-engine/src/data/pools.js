// Content pools. All names, towns and streets are fictional.

export const FIRST_NAMES = [
  'Marta', 'Ellis', 'Dana', 'Ruben', 'Iris', 'Cole', 'Nadia', 'Victor',
  'Priya', 'Owen', 'Lena', 'Marcus', 'Sylvia', 'Gideon', 'Tessa', 'Hollis',
  'Aria', 'Duncan', 'Faye', 'Roman', 'Ines', 'Walter', 'Bea', 'Silas',
  'Noor', 'Casper', 'Vera', 'Ashwin', 'Greta', 'Leo', 'Paloma', 'Ernest',
  'June', 'Bram', 'Odile', 'Harvey', 'Zora', 'Felix', 'Mabel', 'Anton',
];

export const LAST_NAMES = [
  'Voss', 'Calloway', 'Merchant', 'Okafor', 'Lindqvist', 'Barrow', 'Reyes',
  'Ashford', 'Kessler', 'Duval', 'Hartnett', 'Ono', 'Pemberton', 'Slade',
  'Whitlock', 'Ferro', 'Nakamura', 'Bishop', 'Crane', 'Delacroix', 'Marsh',
  'Ostrander', 'Quill', 'Renner', 'Soto', 'Thorne', 'Ueda', 'Vance', 'Wren',
  'Yates',
];

export const TOWNS = [
  'Harlow Point', 'Grayfen', 'Miller’s Reach', 'Cobalt Bay', 'Ashvale',
  'Norwich Hollow', 'Pinemont', 'Duskwater', 'Renfield Crossing', 'Saltmarsh',
];

export const STREETS = [
  'Alder Lane', 'Birchwood Drive', 'Corliss Avenue', 'Dunmore Street',
  'Elm Court', 'Foxglove Road', 'Garland Way', 'Hyacinth Street',
  'Ironbridge Road', 'Juniper Close', 'Kestrel Avenue', 'Larkspur Lane',
  'Mercer Street', 'Nightingale Row', 'Old Quarry Road', 'Prescott Avenue',
];

export const VENUE_NAMES = {
  bar: ['The Rusted Anchor', 'The Copper Kettle', 'The Last Lamplight', 'The Crooked Mast', 'The Hollow Oak Tavern'],
  diner: ['Maple & Main Diner', 'Blue Plate Diner', 'The Nine’s Diner', 'Roadside Rose Diner'],
  motel: ['Starlight Motel', 'Driftwood Inn', 'Pinegrove Motor Lodge'],
  office: ['Riverside Business Park', 'The Granary Offices', 'Corner Exchange Building'],
  store: ['Quickstop 24hr Market', 'Lantern Convenience', 'Northside Grocery'],
  park: ['Wexley Park', 'Old Mill Green', 'Cormorant Point Park'],
  bridge: ['Iron Creek Bridge', 'Old Tannery Bridge', 'Weir Street Overpass'],
};

export const OCCUPATIONS = [
  'pharmacist', 'building contractor', 'high-school teacher', 'harbor master',
  'antiques dealer', 'physiotherapist', 'insurance adjuster', 'chef',
  'auto mechanic', 'librarian', 'real-estate agent', 'electrician',
  'freelance photographer', 'bookkeeper', 'veterinarian', 'ferry operator',
];

export const VICTIM_OCCUPATIONS = [
  'owner of a shipping supply company', 'property developer',
  'owner of the town’s largest hardware store', 'retired judge',
  'owner of a small chain of laundromats', 'antique restorer and appraiser',
];

// Personalities drive statement voice and honest time error (minutes).
export const PERSONALITIES = [
  { id: 'terse', fuzz: 5, opener: 'I’ll keep this short.', closer: 'That’s all I have to say.' },
  { id: 'chatty', fuzz: 15, opener: 'Oh, where do I even start — it was such an ordinary evening, until it wasn’t.', closer: 'If I remember anything else I’ll call the station, I promise.' },
  { id: 'nervous', fuzz: 12, opener: 'I’m not in any trouble, am I? I’ll tell you what I know.', closer: 'That’s everything. Really.' },
  { id: 'precise', fuzz: 4, opener: 'I will state the facts as accurately as I can recall them.', closer: 'I am confident in the times given above.' },
  { id: 'hostile', fuzz: 10, opener: 'I don’t see why I have to explain my evening to anyone, but fine.', closer: 'Are we done here?' },
];

export const WEAPONS = [
  { id: 'candlestick', name: 'heavy brass candlestick', autopsy: 'a heavy, rigid object with a narrow cylindrical striking surface' },
  { id: 'poker', name: 'cast-iron fireplace poker', autopsy: 'a slender, dense metal rod' },
  { id: 'wrench', name: 'large pipe wrench', autopsy: 'a heavy metal tool with an irregular, toothed edge' },
  { id: 'bookend', name: 'marble bookend', autopsy: 'a blunt object with a broad, flat face and squared edge' },
  { id: 'bat', name: 'wooden baseball bat', autopsy: 'a smooth, rounded wooden object of considerable mass' },
  { id: 'trophy', name: 'brass sailing trophy', autopsy: 'a rigid metal object with a heavy weighted base' },
];

// Meal names must read naturally after both "partially digested …" and "ordered the …".
export const MEALS = [
  'meatloaf with mashed potatoes', 'patty melt with onion rings',
  'fried whitefish and coleslaw', 'chicken pot pie', 'Reuben sandwich with fries',
];

// Relationship of a suspect to the victim, with compatible motives.
export const RELATIONSHIPS = [
  { id: 'spouse', label: 'spouse of the victim', motives: ['inheritance', 'insurance', 'affair_coverup'] },
  { id: 'sibling', label: 'sibling of the victim', motives: ['inheritance', 'old_grudge'] },
  { id: 'business_partner', label: 'business partner of the victim', motives: ['business_dispute', 'embezzlement_coverup'] },
  { id: 'employee', label: 'longtime employee of the victim', motives: ['revenge_firing', 'embezzlement_coverup'] },
  { id: 'ex_spouse', label: 'ex-spouse of the victim', motives: ['jealousy', 'insurance'] },
  { id: 'neighbor', label: 'next-door neighbor of the victim', motives: ['property_dispute', 'old_grudge'] },
  { id: 'tenant', label: 'tenant in a building the victim owned', motives: ['eviction_dispute'] },
  { id: 'accountant', label: 'the victim’s personal accountant', motives: ['embezzlement_coverup'] },
  { id: 'old_friend', label: 'old friend of the victim', motives: ['unpaid_debt', 'blackmail_victim'] },
  { id: 'rival', label: 'owner of a rival business', motives: ['business_rivalry'] },
  { id: 'caretaker', label: 'the victim’s part-time caretaker', motives: ['inheritance'] },
  { id: 'poker_buddy', label: 'member of the victim’s weekly card game', motives: ['gambling_debt'] },
];

export const MOTIVES = {
  inheritance: {
    label: 'inheritance',
    fact: (s, v) => `${v}’s will was revised eight months ago; nearly the entire estate now passes to ${s}.`,
    gossip: (s, v) => `Everyone in town knows ${v} rewrote the will — ${s} stands to get almost everything.`,
  },
  insurance: {
    label: 'life insurance payout',
    fact: (s, v) => `${s} is the named beneficiary of a life-insurance policy on ${v} worth a very large sum, taken out within the last two years.`,
    gossip: (s, v) => `I heard ${s} took out one of those big insurance policies on ${v}. Struck me as odd at the time.`,
  },
  affair_coverup: {
    label: 'covering up an affair',
    fact: (s, v) => `${v} had recently confronted ${s} about an affair and, per a close associate, threatened a divorce that would leave ${s} with nothing.`,
    gossip: (s, v) => `${v} found out about ${s} seeing someone on the side. There was a screaming match about it — half the street heard.`,
  },
  business_dispute: {
    label: 'a business dispute',
    fact: (s, v) => `Filed correspondence shows ${v} was preparing to dissolve the partnership with ${s} and force a buyout on unfavorable terms.`,
    gossip: (s, v) => `${v} was about to squeeze ${s} out of the business. ${s} would have been ruined.`,
  },
  embezzlement_coverup: {
    label: 'covering up embezzlement',
    fact: (s, v) => `A preliminary review of the books suggests ${v} had discovered irregularities pointing to ${s} and had requested a formal audit for next month.`,
    gossip: (s, v) => `Word is ${v} caught ${s} with a hand in the till and was about to bring in auditors.`,
  },
  revenge_firing: {
    label: 'revenge over a dismissal',
    fact: (s, v) => `${v} terminated ${s}’s employment two weeks ago after fifteen years, without severance; witnesses describe a heated public confrontation afterward.`,
    gossip: (s, v) => `${v} fired ${s} out of nowhere after all those years. ${s} said — in front of people — that ${v} would regret it.`,
  },
  jealousy: {
    label: 'jealousy',
    fact: (s, v) => `${s} reportedly objected bitterly to ${v}’s new relationship; a complaint on file describes ${s} repeatedly showing up uninvited at ${v}’s home.`,
    gossip: (s, v) => `${s} never accepted the divorce. Kept turning up at ${v}’s place at all hours.`,
  },
  property_dispute: {
    label: 'a property dispute',
    fact: (s, v) => `${s} and ${v} were in an escalating legal dispute over a property line; ${v} had recently won a ruling that would cost ${s} a considerable amount.`,
    gossip: (s, v) => `That fence dispute between ${s} and ${v} got ugly. Lawyers, surveys, the whole circus — and ${s} lost.`,
  },
  old_grudge: {
    label: 'a longstanding grudge',
    fact: (s, v) => `Family associates describe a decades-old falling-out between ${s} and ${v} over money, never reconciled and recently reignited.`,
    gossip: (s, v) => `${s} and ${v} hadn’t truly spoken in years — bad blood over money, way back. It flared up again recently.`,
  },
  eviction_dispute: {
    label: 'an eviction dispute',
    fact: (s, v) => `${v} had served ${s} with a final eviction notice effective at the end of the month; ${s} had nowhere lined up to go.`,
    gossip: (s, v) => `${v} was putting ${s} out on the street at the end of the month. ${s} was desperate about it.`,
  },
  unpaid_debt: {
    label: 'an unpaid debt',
    fact: (s, v) => `A signed note shows ${s} owed ${v} a substantial personal loan; ${v} had begun demanding repayment in full.`,
    gossip: (s, v) => `${s} borrowed serious money from ${v} and couldn’t pay it back. ${v} had started asking for all of it.`,
  },
  blackmail_victim: {
    label: 'being blackmailed by the victim',
    fact: (s, v) => `Papers found in ${v}’s study suggest ${v} knew something damaging about ${s} and had received regular unexplained cash payments consistent with blackmail.`,
    gossip: (s, v) => `People say ${v} had something on ${s}. ${s} always went quiet whenever ${v} was around.`,
  },
  business_rivalry: {
    label: 'a business rivalry',
    fact: (s, v) => `${v} had recently undercut and won three contracts previously held by ${s}’s firm, placing ${s} near insolvency.`,
    gossip: (s, v) => `${v} was strangling ${s}’s business, contract by contract. ${s} was months from closing down.`,
  },
  gambling_debt: {
    label: 'a gambling debt',
    fact: (s, v) => `Ledger pages from the weekly card game indicate ${s} owed ${v} heavily and had been given a deadline.`,
    gossip: (s, v) => `Their card game wasn’t friendly. ${s} was in deep to ${v}, and ${v} wanted it settled.`,
  },
};

// Innocent secrets: unrelated wrongdoing that makes people lie.
export const SECRETS = [
  { id: 'affair', label: 'is having an affair', plan: 'motel' },
  { id: 'gambling', label: 'gambles at an illegal back-room game', plan: 'bar_backroom' },
  { id: 'moonlighting', label: 'is secretly interviewing to leave their employer', plan: 'office_late' },
];

export const NPC_ROLES = {
  bartender: 'bartender',
  waitress: 'diner waitress',
  dinner_guest: 'dinner guest',
};

export const TIERS = {
  rookie: { suspects: [6, 7], competing: 2, secrets: 1 },
  detective: { suspects: [9, 11], competing: 3, secrets: 2 },
};
