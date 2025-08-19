import pyttsx3

# Initialize TTS engine
engine = pyttsx3.init()

# Choose a voice 
voices = engine.getProperty("voices")
engine.setProperty("voice", voices[1].id)  # 0 = male, 1 = female 

# Adjust speaking rate 
engine.setProperty("rate", 190)

# Adjust volume (0.0 to 1.0)
engine.setProperty("volume", 1.0)

# Text you want to convert
text = """
The clock ticks loud when you're alone,
Walls whisper secrets you used to own.
Shattered echoes in my chest, a broken rhythm,
No rest, no rest.
"""

print(f"🔊 Speaking...\n{text}")
engine.say(text)

# Waits until audio finishes
engine.runAndWait()
print("✅ Done.")
