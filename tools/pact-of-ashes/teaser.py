import json

secs = json.load(open('novel.json'))

# Sections WITHOUT any prose bodies - opening line only.
sections = [{
    'id': s['id'], 'kind': s['kind'], 'number': s['number'], 'title': s['title'],
    'epigraph': s['epigraph'], 'words': s['words'], 'descent': s['descent'],
} for s in secs if s['kind'] not in ('preface', 'acknowledgment')]

whispers = [
    "Don't forget. Don't forgive. Kill.",
    "Why do you look so lost, sister?",
    "Crying is for the living.",
    "Ink doesn't decide. Ash does.",
    "Let them think this is surrender.",
    "Let her clutch the leash tighter.",
    "I have never been more proud.",
]

quotes = [
    {"text": "The Devil did not roar. The Devil wore her brother's voice.", "section": "prologue"},
    {"text": "Power was not respect. Power was fear.", "section": "chapter-4"},
    {"text": "Iron gates heavy as tomb doors.", "section": "chapter-6"},
    {"text": "Then the torch nearest the door sputtered out.", "section": "chapter-7"},
    {"text": "It hurt more than the blade had.", "section": "chapter-13"},
    {"text": "How do you kill someone who is already dead?", "section": "chapter-20"},
    {"text": "Men respect fire, because it erases everything it touches.", "section": "chapter-22"},
    {"text": "He doesn't know what silence is.", "section": "chapter-34"},
    {"text": "The judge's pearls clicked once more.", "section": "chapter-47"},
    {"text": "He closed the ledger with a snap.", "section": "chapter-64"},
]

characters = [
    {"id": "kate", "name": "Kate", "role": "The one who came back",
     "line": "They had taken her knives. They had taken her freedom.",
     "brief": "An assassin who died badly in a dungeon and did not stay dead. What walks the city now wears her face and moves like her, and every so often it is still her.",
     "redacted": "what is left of her by the last page"},
    {"id": "kael", "name": "Kael", "role": "The brother",
     "line": "You couldn't save me.",
     "brief": "They killed him first, slowly, and made her watch. Everything that follows is the shape of that hour.",
     "redacted": "whether his voice is ever really his"},
    {"id": "devil", "name": "The Devil", "role": "The one that answered",
     "line": "The Devil wore her brother's face.",
     "brief": "It does not roar. It does not bargain loudly. It speaks in the voice you would forgive anything, and it is very patient.",
     "redacted": "the price, and when it is collected"},
    {"id": "varos", "name": "Varos", "role": "A king in stolen crowns",
     "line": "He walked the streets like a king wearing stolen crowns.",
     "brief": "Loud, greedy, feared. He mistook the silence around him for obedience. It was not obedience.",
     "redacted": "how long the manor held"},
    {"id": "hale", "name": "Marcus Hale", "role": "The tower",
     "line": "Marcus Hale lived by ritual.",
     "brief": "Hale Industries glitters above the filth like it was never made of it. Black coffee, two sugars, every morning at five-thirty, without an alarm.",
     "redacted": "which ritual he breaks first"},
    {"id": "jackson", "name": "Jackson", "role": "Head of security",
     "line": "Knife work. Clean. Deliberate.",
     "brief": "Paid to see what is coming. Square shoulders, tailored suit, earpiece coiled tight. He is very good at his job.",
     "redacted": "whether good was enough"},
    {"id": "kraye", "name": "Kraye", "role": "Hunter",
     "line": "He didn't drink. Didn't laugh.",
     "brief": "A jaw like cracked stone and a right hand always gloved, burned years ago in a house fire nobody called an accident.",
     "redacted": "what he finds"},
    {"id": "sable", "name": "Sable", "role": "Hunter",
     "line": "Beautiful the way broken glass is beautiful.",
     "brief": "Once intelligence. She knows how to vanish and how to pry open the things people bury. Nails painted black.",
     "redacted": "which side she is standing on at the end"},
    {"id": "icarus", "name": "Icarus", "role": "Hunter",
     "line": "Not because he flew too high, but because he didn't care if he burned.",
     "brief": "Barely past twenty, with older eyes than anyone in the room. Raised on the Council's money and their violence.",
     "redacted": "how close he gets"},
    {"id": "judge", "name": "The Judge", "role": "The Council",
     "line": "She rechecked the locks twice.",
     "brief": "Hers is the silence of discipline and order. She polishes her pearls. She stacks her papers square. She mistakes routine for law.",
     "redacted": "the night the routine fails"},
    {"id": "silver", "name": "The Silver-Haired Woman", "role": "The Council",
     "line": "Her voice was quiet, which made it more dangerous.",
     "brief": "She leans on the glass and leaves smudges she does not bother to wipe. Sharp, merciless calm. She reads her own reflection as truth.",
     "redacted": "what the mirrors were hiding"},
    {"id": "scribe", "name": "The Gray-Suited Man", "role": "The Council",
     "line": "The gray-suited man lived in ledgers.",
     "brief": "Fountain pen uncapped, page turned, date written in a hand so careful it might as well be carved. The world is chaos; the ledger makes it clean.",
     "redacted": "whose scripture he was actually keeping"},
]

ledger = [
    {"name": "Varos",             "epithet": "the stolen crown"},
    {"name": "Marcus Hale",       "epithet": "the tower"},
    {"name": "Kraye",             "epithet": "the gloved hand"},
    {"name": "Sable",             "epithet": "the broken glass"},
    {"name": "Icarus",            "epithet": "the boy who burned"},
    {"name": "The Banker",        "epithet": "the trembling hand"},
    {"name": "The Judge",         "epithet": "the counted pearls"},
    {"name": "The Silver-Haired", "epithet": "the smudged glass"},
    {"name": "The Gray Suit",     "epithet": "the closing ledger"},
]

data = {
    "meta": {
        "title": "The Pact of Ashes",
        "chapters": 77, "sections": len(sections),
        "words": sum(s['words'] for s in secs),
        "question": "What is the real cost of devotion?",
        "invitation": "It will start when you say yes — and like all true bargains, it will require something back of you before it is finished.",
    },
    "sections": sections,
    "whispers": whispers,
    "quotes": quotes,
    "characters": characters,
    "ledger": ledger,
}

json.dump(data, open('teaser.json','w'), ensure_ascii=False, indent=1)
raw = open('teaser.json').read()
print('teaser bytes', len(raw), '| sections', len(sections), '| full manuscript was', len(open('novel.json').read()))
