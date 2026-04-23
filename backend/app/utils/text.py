import unicodedata
import random
import re

# Common function words to skip when masking (not meaningful to test)
STOP_WORDS = {
    # French
    "le","la","les","un","une","des","de","du","d","l",
    "et","ou","ni","mais","donc","or","car","si",
    "je","tu","il","elle","nous","vous","ils","elles","on",
    "me","te","se","lui","y","en","leur",
    "ce","ça","cela","ceci","c",
    "mon","ton","son","ma","ta","sa","mes","tes","ses",
    "notre","votre","nos","vos","leurs",
    "qui","que","quoi","dont","où","qu",
    "a","à","au","aux","dans","sur","sous","avec","par",
    "pour","sans","entre","vers","chez","par",
    "est","sont","ont","ai","as","avait","avoir","être",
    "pas","plus","très","bien","tout","tous","toute","toutes",
    "ne","n","j",
    # English
    "the","a","an","of","in","on","at","to","for","as",
    "and","or","but","not","with","by","from","up","about",
    "i","you","he","she","we","they","it","me","him","her","us","them",
    "my","your","his","its","our","their",
    "am","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should",
    "this","that","these","those","there","here",
    "so","if","then","when","than","just","no","all",
}


_LIGATURES = str.maketrans({"œ": "oe", "æ": "ae"})

def normalize(word: str) -> str:
    nfkd = unicodedata.normalize("NFKD", word.lower().translate(_LIGATURES))
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def check_answer(user_input: str, expected: str) -> bool:
    return normalize(user_input.strip()) == normalize(expected.strip())


def tokenize_lyrics(text: str) -> list[dict]:
    tokens = []
    parts = re.split(r"(\s+)", text)
    for part in parts:
        if part == "":
            continue
        if "\n" in part:
            for char in part:
                if char == "\n":
                    tokens.append({"type": "newline", "value": "\n"})
                elif char == " ":
                    tokens.append({"type": "space", "value": " "})
        elif part.isspace():
            tokens.append({"type": "space", "value": part})
        else:
            tokens.append({"type": "word", "value": part})
    return tokens


def _is_meaningful(word: str) -> bool:
    """Return True if a word is worth testing (not a stop word or too short)."""
    clean = re.sub(r"[^\w]", "", word.lower())
    if len(clean) <= 2:
        return False
    if normalize(clean) in STOP_WORDS:
        return False
    return True


def mask_lyrics(text: str, difficulty: str, seed: int = None) -> list[dict]:
    ratios = {"easy": 1 / 5, "medium": 1 / 3, "hard": 1 / 2, "extreme": 1.0}
    ratio = ratios.get(difficulty, 1 / 3)

    state = None
    if seed is not None:
        state = random.getstate()
        random.seed(seed)

    tokens = tokenize_lyrics(text)

    if ratio >= 1.0:
        # Extreme: mask everything
        word_indices = [i for i, t in enumerate(tokens) if t["type"] == "word"]
        masked_indices = set(word_indices)
    else:
        # Smart masking: prefer meaningful words
        meaningful = [i for i, t in enumerate(tokens) if t["type"] == "word" and _is_meaningful(t["value"])]
        filler     = [i for i, t in enumerate(tokens) if t["type"] == "word" and not _is_meaningful(t["value"])]

        n_total = len(meaningful) + len(filler)
        n_to_mask = max(1, round(n_total * ratio))

        # Take from meaningful first, fall back to filler if needed
        n_meaningful = min(n_to_mask, len(meaningful))
        chosen = random.sample(meaningful, n_meaningful)

        if n_meaningful < n_to_mask and filler:
            n_extra = min(n_to_mask - n_meaningful, len(filler))
            chosen += random.sample(filler, n_extra)

        masked_indices = set(chosen)

    result = []
    for i, token in enumerate(tokens):
        if i in masked_indices:
            result.append({"type": "blank", "value": token["value"]})
        else:
            result.append(token)

    if state is not None:
        random.setstate(state)
        
    return result
