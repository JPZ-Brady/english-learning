# -*- coding: utf-8 -*-
r"""
把词库里所有单词 + 例句预先生成成 mp3，放进 audio\ 文件夹，学习台以后优先播放这些本地文件。
用的是 edge-tts（微软 Edge「大声朗读」的神经语音，免费、不用注册），生成一次永久可用，离线也能播。

用法（在 English Learning 文件夹里）：
    python 生成发音.py                 # 单词 + 例句
    python 生成发音.py --words-only    # 只生成单词
    python 生成发音.py --voice en-GB-RyanNeural   # 换成男声
已经生成过的文件会自动跳过；词库新增了词，再跑一次就只补新的。
"""
import argparse, asyncio, hashlib, json, os, re, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, 'audio')
PART_RE = re.compile(r'window\.DECK_PARTS\[\s*"([^"]+)"\s*\]\s*=\s*')


def js_to_json(src):
    """词库文件是 JS 对象字面量（键名不带引号），转成标准 JSON：给裸键名加引号、单引号串转双引号、去注释和尾逗号。"""
    out, i, n = [], 0, len(src)
    while i < n:
        ch = src[i]
        if ch in '"\'':
            q, j, buf = ch, i + 1, []
            while j < n and src[j] != q:
                if src[j] == '\\':
                    buf.append(src[j:j + 2]); j += 2; continue
                buf.append(src[j]); j += 1
            body = ''.join(buf)
            body = body.replace("\\'", "'")            # JS 允许 \'，JSON 不允许
            if q == "'":
                body = body.replace('"', '\\"')
            out.append('"' + body + '"'); i = j + 1
        elif src.startswith('//', i):
            j = src.find('\n', i); i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2
        elif ch.isalpha() or ch in '_$':
            j = i
            while j < n and (src[j].isalnum() or src[j] in '_$'):
                j += 1
            word, k = src[i:j], j
            while k < n and src[k] in ' \t\r\n':
                k += 1
            out.append('"' + word + '"' if k < n and src[k] == ':' and word not in ('true', 'false', 'null') else word)
            i = j
        elif ch in ']}':
            k = len(out) - 1
            while k >= 0 and out[k] in (' ', '\t', '\r', '\n'):
                k -= 1
            if k >= 0 and out[k] == ',':            # 去掉尾逗号（只在字符串外）
                del out[k]
            out.append(ch); i += 1
        else:
            out.append(ch); i += 1
    return ''.join(out)


def load_parts():
    """读 deck-parts\\*.js 和 notes-cards.js 里的 window.DECK_PARTS["xx"] = [...] 数组。"""
    files = [os.path.join(HERE, 'deck-parts', f) for f in sorted(os.listdir(os.path.join(HERE, 'deck-parts'))) if f.endswith('.js')]
    if os.path.exists(os.path.join(HERE, 'notes-cards.js')):
        files.append(os.path.join(HERE, 'notes-cards.js'))
    parts, dec = {}, json.JSONDecoder()
    for fp in files:
        s = open(fp, encoding='utf-8').read()
        for m in PART_RE.finditer(s):
            arr, _ = dec.raw_decode(js_to_json(s[m.end():]))
            parts[m.group(1)] = arr
    return parts


def file_for(text, voice):
    """同一句话 + 同一个声音 → 固定文件名，换声音不会覆盖旧文件。"""
    return hashlib.md5((voice + '|' + text).encode('utf-8')).hexdigest()[:16] + '.mp3'


def write_index(texts, voice):
    """只把真正存在的文件写进索引，学习台靠它判断哪句有本地音频。"""
    idx = {}
    for t in texts:
        fn = file_for(t, voice)
        p = os.path.join(AUDIO, fn)
        if os.path.exists(p) and os.path.getsize(p) > 0:
            idx[t] = fn
    tmp = os.path.join(AUDIO, 'index.js.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write('/* 自动生成，请勿手改 —— 由 生成发音.py 生成，' + time.strftime('%Y/%m/%d %H:%M:%S') +
                '，声音 ' + voice + '，共 ' + str(len(idx)) + ' 条 */\n')
        f.write('window.AUDIO_VOICE = ' + json.dumps(voice) + ';\n')
        f.write('window.AUDIO_INDEX = ' + json.dumps(idx, ensure_ascii=False) + ';\n')
    os.replace(tmp, os.path.join(AUDIO, 'index.js'))
    return len(idx)


async def gen_one(edge_tts, text, path, voice, sem, stat):
    async with sem:
        for attempt in range(4):
            try:
                tmp = path + '.part'
                await edge_tts.Communicate(text, voice).save(tmp)
                if os.path.getsize(tmp) == 0:
                    raise RuntimeError('生成了空文件')
                os.replace(tmp, path)
                stat['ok'] += 1
                return
            except Exception as e:
                err = repr(e)
                await asyncio.sleep(2 ** attempt)
        stat['fail'] += 1
        stat['errs'].append(text[:60] + '  ←  ' + err[:200])


SAMPLE_VOICES = ['en-GB-SoniaNeural', 'en-GB-RyanNeural', 'en-GB-LibbyNeural', 'en-GB-ThomasNeural', 'en-GB-MaisieNeural']
SAMPLE_TEXTS = ['kettle', 'No through road', 'Shall I put the kettle on?',
                'The results were statistically significant across all three datasets.']


async def make_samples(edge_tts):
    """同样几句话用几种英音各读一遍，文件名带声音名，方便对比着听。"""
    out = os.path.join(HERE, 'audio-试听')
    os.makedirs(out, exist_ok=True)
    print('试听样本 → ' + out)
    for v in SAMPLE_VOICES:
        short = v.replace('en-GB-', '').replace('Neural', '')
        for i, t in enumerate(SAMPLE_TEXTS, 1):
            p = os.path.join(out, '%s-%d.mp3' % (short, i))
            try:
                await edge_tts.Communicate(t, v).save(p)
                print('  %-7s %d  %s' % (short, i, t))
            except Exception as e:
                print('  %-7s %d  失败：%r' % (short, i, e))
    print('听完选一个，正式生成时加 --voice 声音全名，例如 --voice en-GB-RyanNeural')
    if os.name == 'nt':
        os.startfile(out)   # 生成完直接打开文件夹


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--voice', default='en-GB-SoniaNeural')
    ap.add_argument('--words-only', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='只生成前 N 条（试跑用）')
    ap.add_argument('--jobs', type=int, default=4, help='同时请求数，太大可能被限流')
    ap.add_argument('--sample', action='store_true', help='只生成几种英音的试听样本到 audio-试听\\，不动 audio\\ 和索引')
    a = ap.parse_args()

    try:
        import edge_tts
    except ImportError:
        print('没装 edge-tts。先运行：python -m pip install edge-tts')
        sys.exit(1)

    if a.sample:
        await make_samples(edge_tts)
        return

    parts = load_parts()
    words, exs = [], []
    for k in sorted(parts):
        for d in parts[k] or []:
            en = str(d.get('en') or '').strip()
            if en:
                words.append(en)
            for e in d.get('ex') or []:
                t = str(e.get('e') or '').strip()
                if t:
                    exs.append(t)
    all_texts = list(dict.fromkeys(words + exs))   # 索引永远按全部内容写，--words-only 不会把已有例句挤出索引
    texts = list(dict.fromkeys(words)) if a.words_only else all_texts
    if a.limit:
        texts = texts[:a.limit]

    os.makedirs(AUDIO, exist_ok=True)
    todo = [t for t in texts if not os.path.exists(os.path.join(AUDIO, file_for(t, a.voice)))]
    print('词库分组 %d 个 | 单词 %d | 例句 %d | 本次要处理 %d 条，其中缺音频 %d 条 | 声音 %s'
          % (len(parts), len(set(words)), len(set(exs)), len(texts), len(todo), a.voice))

    stat = {'ok': 0, 'fail': 0, 'errs': []}
    sem = asyncio.Semaphore(max(1, a.jobs))
    t0 = time.time()
    BATCH = 200
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        await asyncio.gather(*[gen_one(edge_tts, t, os.path.join(AUDIO, file_for(t, a.voice)), a.voice, sem, stat) for t in chunk])
        n = write_index(all_texts, a.voice)   # 每批写一次索引，中途关掉也不白跑
        print('  进度 %d/%d | 成功 %d 失败 %d | 索引 %d 条 | 用时 %ds'
              % (min(i + BATCH, len(todo)), len(todo), stat['ok'], stat['fail'], n, time.time() - t0))
    n = write_index(all_texts, a.voice)
    print('完成：audio\\index.js 共 %d 条（词库全部 %d 条），本次新生成 %d，失败 %d' % (n, len(all_texts), stat['ok'], stat['fail']))
    if stat['errs']:
        print('失败的前 10 条（完整报错）：')
        for e in stat['errs'][:10]:
            print('  ' + e)
        print('失败的可以直接再跑一次本脚本补上。')


if __name__ == '__main__':
    asyncio.run(main())
