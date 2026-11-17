import json  # 把 Python 字典转成 JSON 文字，工具结果要用文字交回给模型
import anthropic  # Claude 官方 Python SDK
from gen_examples import load_cards  # 复用周四写的读词库函数（gen_examples.py 要和本文件在同一个文件夹）

client = anthropic.Anthropic()  # 创建客户端，Key 从环境变量 ANTHROPIC_API_KEY 读
CARDS = load_cards()  # 词库读进来：英文 → 这张卡的信息（中文、分片等）


# 真正"查词"的函数：模型只会说"我要查哪个词"，执行它的是你的代码
def lookup_word(word):
    c = CARDS.get(word)  # 在词库字典里找；找不到时 .get 返回 None，不会报错
    if c is None:
        return json.dumps({"found": False}, ensure_ascii=False)  # 没找到也要告诉模型，别让它瞎编
    # 找到了：返回中文意思和所在分片；ensure_ascii=False 让中文原样输出，不变成 \uXXXX
    return json.dumps({"found": True, "zh": c["zh"], "deck": c["deck"]}, ensure_ascii=False)


# 工具说明书：告诉模型有哪些工具、每个干什么、要什么参数（这是一个列表，可以放好几个工具）
tools = [{
    "name": "lookup_word",  # 工具名，模型调用时就用这个名字
    "description": "在用户自己的背词台词库里查一个英文单词或短语，返回它在词库里的中文意思",  # 模型靠这句话决定什么时候用它
    "input_schema": {  # 参数的格式，用 JSON Schema 写，和周三的结构化输出是同一套写法
        "type": "object",  # 参数整体是一个对象（对应 Python 的字典）
        "properties": {
            "word": {"type": "string", "description": "要查的英文单词或短语，和词库里的写法一致"},  # 唯一的参数 word，是字符串
        },
        "required": ["word"],  # word 必须给
        "additionalProperties": False,  # 不许多出别的参数
    },
    "strict": True,  # 严格模式：模型给的参数一定符合上面的格式
}]


# 发一次请求，每次都带上工具说明书
def chat(messages):
    return client.messages.create(
        model="claude-haiku-5-5",  # 用最便宜的 Haiku
        max_tokens=2000,  # 回答最多 2000 token
        tools=tools,  # 把工具说明书交给模型
        messages=messages,  # 到目前为止的全部对话
        output_config={"effort": "low"},  # 少思考，快、省钱
    )


# 循环版：模型想查几次就查几次，直到它不再要工具，最多转 max_steps 圈
def run(question, max_steps=5):
    messages = [{"role": "user", "content": question}]  # 对话从用户的问题开始
    for step in range(max_steps):  # 最多转 5 圈，防止模型一直调工具停不下来、一直花钱
        resp = chat(messages)  # 把到目前为止的全部对话发给模型
        messages.append({"role": "assistant", "content": resp.content})  # 模型的回答存进对话
        if resp.stop_reason != "tool_use":  # 停下的原因不是"要用工具"，说明它已经答完了
            return "".join(b.text for b in resp.content if b.type == "text")  # 拼出文字回答，结束
        results = []  # 这一圈所有工具调用的结果（模型可能一次要查好几个词）
        for b in resp.content:
            if b.type == "tool_use":  # 只处理工具调用块，文字块跳过
                result = lookup_word(**b.input)  # 你的代码真正去查词库
                print(f"  第 {step + 1} 步：调用 {b.name}({b.input}) → {result}")  # 打印出来，看模型每一步在干什么
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": result})  # id 对上那次调用
        messages.append({"role": "user", "content": results})  # 结果发回去，进入下一圈
    return "（超过最多步数，停下）"  # 转满 5 圈还没答完，就放弃


print(run("我词库里的 put sth off 是什么意思？按词库里的意思各造一个句子。"))  # 只查一个词：一般转 2 圈