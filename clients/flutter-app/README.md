# Interview Genie – Mobile (Flutter)

Record your interview question and get a STAR-format answer from the backend.

## Setup

```bash
flutter pub get
```

If this is a new project and `android/` or `ios/` are missing:

```bash
flutter create .
```

Then add permissions:

- **Android**: In `android/app/src/main/AndroidManifest.xml` add:
  ```xml
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  ```
- **iOS**: In `ios/Runner/Info.plist` add:
  ```xml
  <key>NSMicrophoneUsageDescription</key>
  <string>Interview Genie needs the microphone to record your question.</string>
  ```

## Run

```bash
flutter run
```

Use API URL `ws://10.0.2.2:8000/ws/audio` for Android emulator (localhost). On a real device, use your machine’s IP (e.g. `ws://192.168.1.10:8000/ws/audio`).
