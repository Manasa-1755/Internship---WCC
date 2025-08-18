from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)
app.secret_key = "supersecret"

API_KEY = "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"
API_URL = "https://openrouter.ai/api/v1/chat/completions"

def chat_with_model(messages, model="openai/gpt-4o-mini"):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "model": model,
        "messages": messages,
        "max_tokens": 1000
    }

    response = requests.post(API_URL, headers=headers, json=data)

    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"Error {response.status_code}: {response.text}"

@app.route("/")
def index():
    # Pass greeting to template so it's shown immediately
    greeting = "Hello! 👋 I’m your AI assistant. How can I help you today?"
    return render_template("index.html", greeting=greeting)

@app.route("/chat", methods=["POST"])
def chat():
    user_input = request.json.get("message", "")
    model = request.json.get("model", "openai/gpt-4o-mini")

    # Build the messages payload properly
    messages = [
        {"role": "user", "content": user_input}
    ]

    reply = chat_with_model(messages, model)

    return jsonify({"reply": reply})

if __name__ == "__main__":
    app.run(debug=True)
