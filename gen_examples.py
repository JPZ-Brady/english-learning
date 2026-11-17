import os, re, json, glob, random, argparse, datetime, time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import anthropic
import json5
from ai_card import make

PRICE_IN = 0.10   # 美元 / 百万输入 token（claude-haiku-5-5，单次提示不超过 10 万 token）
PRICE_OUT = 0.50  # 美元 / 百万输出 token（同上，思考用的 token 也算输出）


def load_cards():
    cards = {}
    for f in sorted(glob.glob("deck-parts/*.js")):
        text = open(f, encoding="utf-8").read()
        for name, arr in re.findall(r'window\.DECK_PARTS\["([^"]+)"\]\s*=\s*(\[.*?\]);', text, re.S):
            for c in json5.loads(arr):
                c["deck"] = name
                cards.setdefault(c["en"], c)
    return cards

def replace_retry(src, dst, tries=20):
    # Windows can briefly lock a file (antivirus scan, a browser tab reading it): wait and retry
    for k in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if k == tries - 1:
                raise
            time.sleep(0.5)

def save(done, out):
    # 先写临时文件再改名：中途按 Ctrl+C 也不会留下写了一半的文件
    files = {
        out + ".json": json.dumps(done, ensure_ascii=False, indent=1),
        out + ".js": "window.AI_EXAMPLES = " + json.dumps(done, ensure_ascii=False) + ";\n",
    }
    for name, text in files.items():
        with open(name + ".tmp", "w", encoding="utf-8") as f:
            f.write(text)
        replace_retry(name + ".tmp", name)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--deck", default="01-phrasal-verbs", help="分片名；all 表示所有分片")
    p.add_argument("--limit", type=int, default=50, help="这次最多新生成多少个")
    p.add_argument("--words", help="只生成这个文件里列出的词（一行一个）")
    p.add_argument("--out", default="ai-examples", help="输出文件名前缀，会写 <out>.json 和 <out>.js")
    p.add_argument("--workers", type=int, default=4, help="同时处理几个词（并发数）")
    args = p.parse_args()

    try:
        done = json.load(open(args.out + ".json", encoding="utf-8"))
    except FileNotFoundError:
        done = {}

    cards = load_cards()
    if args.words:
        wanted = [w.strip() for w in open(args.words, encoding="utf-8-sig") if w.strip()]
        unknown = [w for w in wanted if w not in cards]
        if unknown:
            print("词库里没有这些词：", unknown)
        todo = [cards[w] for w in wanted if w in cards and w not in done]
        label = args.words
    else:
        todo = [c for c in cards.values() if (args.deck == "all" or c["deck"] == args.deck) and c["en"] not in done]
        label = args.deck
    todo = todo[: args.limit]
    print(f"{label}：{args.out}.json 里已有 {len(done)} 个，这次要生成 {len(todo)} 个")

    total_in = total_out = 0
    failed = []
    unsaved = 0
    t0 = time.time()
    # several words in flight at once; each call mostly waits for the model, so threads are enough
    pool = ThreadPoolExecutor(max_workers=max(1, args.workers))
    futures = {pool.submit(make, c["en"], c["zh"]): c for c in todo}
    def finished():
        # wait with a 1 s timeout so Ctrl+C is noticed promptly on Windows too
        pending = set(futures)
        while pending:
            ready, pending = wait(pending, timeout=1, return_when=FIRST_COMPLETED)
            yield from ready

    try:
        for i, fut in enumerate(finished(), 1):
            c = futures[fut]
            data, (tin, tout) = fut.result()
            total_in += tin
            total_out += tout
            if data is None:
                failed.append(c["en"])
                print(f"[{i}/{len(todo)}] {c['en']}：3 次都没通过检查，跳过")
                continue
            q = data["quiz"]
            right = q["options"][q["answer"]]
            random.shuffle(q["options"])
            q["answer"] = q["options"].index(right)
            data["zh"] = c["zh"]
            data["date"] = datetime.date.today().isoformat()
            done[c["en"]] = data
            unsaved += 1
            if unsaved >= 10:
                save(done, args.out)
                unsaved = 0
            print(f"[{i}/{len(todo)}] {c['en']}：好了")
            if i % 50 == 0:
                cost = total_in / 1e6 * PRICE_IN + total_out / 1e6 * PRICE_OUT
                mins = (time.time() - t0) / 60
                print(f"—— 到目前为止这次花了约 ${cost:.4f}，用时 {mins:.1f} 分钟")
    except anthropic.APIError as e:
        print(f"接口报错，先停下：{type(e).__name__}: {e}")
        print("已经生成的都存好了，问题解决后重新运行同一条命令，会从没做的词接着做。")
    except KeyboardInterrupt:
        print("手动停止。已经生成的都存好了，重新运行同一条命令会接着做（正在处理的几个词会再等几秒才退出）。")
    finally:
        # whatever happens, stop queued words so no more paid calls run after we stop, then save
        pool.shutdown(wait=False, cancel_futures=True)
        save(done, args.out)

    print(f"用时 {(time.time() - t0) / 60:.1f} 分钟")
    cost = total_in / 1e6 * PRICE_IN + total_out / 1e6 * PRICE_OUT
    print(f"输入 {total_in} token，输出 {total_out} token，按单价估算约 ${cost:.4f}")
    if failed:
        print(f"没通过检查、跳过的词（{len(failed)} 个）：", failed)


if __name__ == "__main__":
    main()
    