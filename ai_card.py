import json
import re
import anthropic

# max_retries: the SDK retries rate-limit / overload errors with backoff
client = anthropic.Anthropic(max_retries=5)

SYSTEM = """你是英语老师，给在英国读研的中国学生出背单词材料。
用户会给一个英文单词或短语，以及它在词库里的中文意思。
examples 写 3 条例句，en 是英文例句，zh 是中文翻译。
quiz 是一道四选一填空题：question 是一个英文句子，用 ____ 挖掉这个词；options 是 4 个不同的英文单词或短语；answer 是正确选项在 options 里的位置（0 到 3）；answer_sentence 是把正确选项原样填进 ____ 之后的完整句子。
要求：
1. 例句只能用词库给出的中文意思（用；隔开的是几个不同意思，可以分开用），场景贴近英国留学生活。每条例句都必须真的用到这个词或短语（可以变时态）。
2. question 里只有一个 ____，挖掉的是连续的一段。题目考的意思必须是词库给出的中文意思之一。
3. 正确选项要写成填进句子后的样子：时态、人称、单复数都要对（比如过去时就写 found out，不写 find out）。____ 前后不要再出现选项里已经有的词（不能写成 ____ with 而选项是 get on with）。短语的宾语是 it、them 这类代词时，要放在短语中间（look it up），这种句子宁可换一个名词宾语。
4. 另外 3 个选项用和正确选项一样的形式（同样的时态），必须是真实存在的英文，放进句子里明显不对。
5. 写完把 answer_sentence 从头读一遍，确认它是一个完全通顺、意思正确的英文句子。"""

SCHEMA = {
    "type": "object",
    "properties": {
        "examples": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"en": {"type": "string"}, "zh": {"type": "string"}},
                "required": ["en", "zh"],
                "additionalProperties": False,
            },
        },
        "quiz": {
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}},
                "answer": {"type": "integer"},
                "answer_sentence": {"type": "string"},
            },
            "required": ["question", "options", "answer", "answer_sentence"],
            "additionalProperties": False,
        },
    },
    "required": ["examples", "quiz"],
    "additionalProperties": False,
}


def ask(word, zh):
    resp = client.messages.create(
        model="claude-haiku-5-5",
        max_tokens=2000,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"单词：{word}\n中文意思：{zh}"}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return text, resp.stop_reason, resp.usage

PLACEHOLDERS = {"sb", "sth", "sb/sth", "sth/sb", "one's", "someone", "something", "do", "doing",
                # pronouns change with the sentence ("pull your weight" -> "pull his weight")
                "i", "me", "my", "myself", "you", "your", "yourself", "he", "him", "his", "himself",
                "she", "her", "herself", "it", "its", "itself", "we", "us", "our", "ourselves",
                "they", "them", "their", "themselves", "this", "that"}
# items that are whole spoken sentences ("could you put me through") are not checked word by word
STARTERS = {"could", "can", "would", "will", "let", "have", "has", "please", "it's", "i", "i'm", "i'd",
            "i'll", "my", "you", "you're", "we", "we'll", "that's", "what", "how", "where", "why",
            "do", "does", "did", "is", "are", "sorry", "thanks", "thank"}
ARTICLES = {"a", "an", "the", "and", "or", "of"}
# a repeated object or "with" right after the blank means a doubled word ("get it back it")
REPEATS = {"it", "them", "him", "her", "me", "us", "with"}

def words(text):
    # apostrophes only inside a word ("isn't"), so quote marks around a sentence are dropped
    return re.findall(r"[a-z]+(?:'[a-z]+)*", text.lower())

def stem(token):
    # "fry" also accepts "fried", "delivery" also accepts "deliveries"
    return token[:-1] if len(token) >= 3 and token[-1] in "ye" else token

def particles(word):
    # every word of a short lowercase phrase except the first (the verb, which may change tense);
    # whole sentences, "A / B" pairs and capitalised items are not checked
    w = re.sub(r"\(.*?\)", " ", word).replace("sb/sth", "sb").replace("sth/sb", "sth").strip()
    if not w or not w[0].islower() or re.search(r"[/?!.…,;]", w) or len(w.split()) > 5:
        return []
    ws = words(w)
    if ws[0] in STARTERS:
        return []
    return [t for t in ws[1:] if t not in PLACEHOLDERS]

def content(word):
    # the words that should show up in the right option, articles and placeholders left out
    return [t for t in words(re.sub(r"\(.*?\)", " ", word)) if t not in PLACEHOLDERS and t not in ARTICLES]

QUOTES = str.maketrans({"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"})

def has(token, ws):
    # prefix match, so "refund" also accepts "refunds"
    return any(w.startswith(stem(token)) for w in ws)

def check(data, word=""):
    ex = data.get("examples")
    if not isinstance(ex, list) or len(ex) != 3:
        return "examples 不是 3 条"
    for e in ex:
        if not e.get("en") or not e.get("zh"):
            return "有例句的 en 或 zh 是空的"
        missing = [t for t in particles(word) if not has(t, words(e["en"].translate(QUOTES)))]
        if missing:
            return f"有例句没用到这个短语（缺 {' '.join(missing)}）"
    q = data["quiz"]
    if q["question"].count("____") != 1:
        return "题目里的 ____ 不是正好一个"
    if len(q["options"]) != 4 or len(set(q["options"])) != 4:
        return "options 不是 4 个不同的选项"
    if q["answer"] not in (0, 1, 2, 3):
        return "answer 不是 0 到 3"
    right = q["options"][q["answer"]].strip()
    before, after = q["question"].split("____")
    rw, bw, aw = words(right.translate(QUOTES)), words(before.translate(QUOTES)), words(after.translate(QUOTES))
    # compare word by word, so spaces, quotes and punctuation don't count; answer_sentence may
    # leave out the start of a long question, but must cover the blank and everything after it
    filled = bw + rw + aw
    said = words(q["answer_sentence"].translate(QUOTES))
    if len(said) < len(rw) + len(aw) or filled[len(filled) - len(said):] != said:
        return "把正确选项填进去和 answer_sentence 对不上"
    if rw and aw and (aw[0] == rw[-1] or (aw[0] in REPEATS and aw[0] in rw)):
        return f"空格后面紧跟的 {aw[0]} 在正确选项里已经有了"
    if rw and bw and bw[-1] == rw[0]:
        return f"空格前面紧挨的 {bw[-1]} 在正确选项里已经有了"
    cw = content(word)
    if len(cw) > 1 and not any(has(t, rw) for t in cw):
        return "正确选项看起来不是这个词"
    return ""

def make(word, zh, tries=3):
    used = [0, 0]
    for i in range(tries):
        text, stop, usage = ask(word, zh)
        used[0] += usage.input_tokens
        used[1] += usage.output_tokens
        if stop != "end_turn":
            print(f"  第 {i + 1} 次：没正常写完（{stop}），重试")
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            print(f"  第 {i + 1} 次：不是合法 JSON，重试")
            continue
        problem = check(data, word)
        if problem:
            print(f"  第 {i + 1} 次：{problem}，重试")
            with open("gen_rejects.log", "a", encoding="utf-8") as f:
                f.write(json.dumps({"word": word, "problem": problem, "quiz": data.get("quiz")}, ensure_ascii=False) + "\n")
            continue
        return data, used
    return None, used


if __name__ == "__main__":
    for word, zh in [("sort sth out", "解决；整理好"), ("put sth off", "推迟；使反感"), ("turn up", "出现；调大音量"),
 ("come across sb/sth", "偶然遇到；给人印象"), ("work sth out", "弄明白；锻炼")]:
        data, used = make(word, zh)
        print(word, used)
        print(json.dumps(data, ensure_ascii=False, indent=1))