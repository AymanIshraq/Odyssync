# Make your own wake word

This folder lets you make a wake word for Odyssync, such as "Hey Odyssync" or "Hey Buddy".
Google's free Colab website does the work on its own computer. You only click buttons.

## 1. Open the notebook in Colab

1. Go to https://colab.research.google.com and sign in with a Google account.
2. Pick one:
   - **File > Upload notebook** and choose `tools/wakeword/train_wake_word.ipynb` from this repo, or
   - use the **GitHub** tab, paste the repo's link and open `tools/wakeword/train_wake_word.ipynb`.

## 2. Turn on the free GPU

**Runtime > Change runtime type > T4 GPU > Save.**
If you forget, the notebook stops at Step 2 and tells you how to fix it.

## 3. Type your phrase

In the **Settings** box at the top:

- `TARGET_PHRASE`: your wake phrase, for example `hey odyssync`.
- `EXTRA_SPELLINGS`: the same phrase written the way it *sounds*, for example
  `["hey oddy sync", "hey odd ee sink"]`. These help the computer voice say a made-up word the way you do.
- Leave the other numbers as they are the first time.

## 4. Run it

**Runtime > Run all.** Keep the browser tab open. It takes about **1 hour**.
In Step 5 you can press play to hear how the computer voice says your phrase. If it sounds wrong,
change `EXTRA_SPELLINGS` and run again.

At the end your browser downloads a file named after your phrase:
`hey odyssync` becomes `hey_odyssync.onnx`.
If nothing downloads, click the folder icon on the left in Colab, right-click the `.onnx` file, then **Download**.

## 5. Put the file where Odyssync looks

Pick one:

- **Inside the app, for everyone:** put it in `sidecar/models/` in this repo. It ships inside the app.
  Use this for **Hey Odyssync**.
- **Only on one Windows laptop:** put it in `%APPDATA%\Odyssync\wakewords\`.
  In the Control Center, the wake-word list's **"Add your own…"** opens this folder for you.

The phrase then appears in the Control Center's wake-word dropdown. Its name comes from the file name:
`hey_buddy.onnx` shows as **"Hey Buddy"**.

## 6. Test it with your microphone (optional)

On any computer with Python:

```
pip install openwakeword onnxruntime sounddevice
python tools/wakeword/test_mic.py path/to/hey_odyssync.onnx
```

Say the phrase. The score goes up toward 1. At 0.5 or more it prints **DETECTED**, the same rule the app uses.

## Tips

- Choose a phrase with **2 to 4 syllables** that is **not a common word** ("Hey Odyssync" is good; "Hello" is not).
- If it misses you often: run again with bigger `POSITIVE_SAMPLES` (for example 6000) and `TRAINING_STEPS`
  (for example 50000), and try better `EXTRA_SPELLINGS`.
- If it wakes up by itself too often: run again with bigger `NEGATIVE_SAMPLES` and `BACKGROUND_FEATURE_ROWS`.

## Licence note

openWakeWord's ready-made wake words (Hey Jarvis, Alexa and so on) are for **non-commercial use only**.
A model you train yourself with this notebook is yours, but check the licences of the training data
(AudioSet, ACAV100M features, MIT room echoes, Piper voices) before selling a product with it.
