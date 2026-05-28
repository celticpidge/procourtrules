# Voice Smoke Checklist

Run this checklist before production pushes that affect voice UX.

## Browsers

- Desktop Chrome (latest)
- iOS Safari (latest)
- Android Chrome (latest)

## Preflight

1. Open the preview URL in each browser.
2. Confirm microphone permission prompt appears and grant access.
3. Confirm microphone icon is enabled.

## Scenario A: Live Appearance

1. Tap/click mic and speak a 5-8 second sentence.
2. Verify text appears in the input while speaking (live preview).
3. Verify recording auto-stops after a short pause.
4. Verify final transcript appears within a few seconds after auto-stop.

## Scenario B: Long Clip Guardrail

1. Start voice and keep speaking continuously.
2. Verify recording stops by 45 seconds.
3. Verify the timeout hint appears: recording auto-stopped at 45 seconds.

## Scenario C: Error Handling

1. Go offline and start voice.
2. Verify a clear error is shown and no app crash occurs.
3. Reconnect and retry voice.
4. Verify recovery works and transcript is produced.

## Pass Criteria

- No unhandled errors in console.
- No stuck "listening" state.
- Auto-stop always completes the flow.
- Transcript accuracy acceptable for normal speech.
