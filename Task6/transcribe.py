import whisper
import textwrap

# Load Whisper model
print("\nLoading Whisper model... \nThis may take a while....\n")
model = whisper.load_model("small")
audio_file = "C:\\Users\\manas\\Downloads\\Shattered Echoes.mp3"

# Transcribe
print(f"\n🔊 Transcribing {audio_file}...\n")
result = model.transcribe(audio_file)

# Get transcription text
raw_text = result["text"]

# Wrap long lines (50 chars per line)
formatted_text = textwrap.fill(raw_text, width=50)

# Print nicely
print("\n📝 Transcription result:\n")
print("\n",formatted_text,"\n")
