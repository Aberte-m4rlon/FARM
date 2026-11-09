# Update ng OpenCV camera gateway

Ang CCTV gateway ay gumagamit na ng OpenCV motion detection at temporal
tracking. Hindi nito ginagamit ang YOLO o model weights para sa CCTV, at hindi
nito mapagkakatiwalaang nakikilala kung kambing o tupa ang galaw.

Pagkatapos mag-update ng code, patakbuhin ang focused tests mula sa
`camera-gateway` folder:

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_motion_tracker tests.test_inference tests.test_event_tracker
```

Sa bagong gateway setup, gamitin ang `requirements.txt`; hindi na kailangan
ang PyTorch o Ultralytics para sa CCTV. Panatilihin ang `.env`, camera
credentials, at `state/camera-crossings-outbox.json` habang nag-a-update.
Huwag magbago ng production API o camera settings para lang sa lokal na test.

Normal na galaw lang ang ipinapakita bilang bounding box matapos makumpirma sa
magkakasunod na frame. Para sa developer debugging, itakda ang
`CAMERA_GATEWAY_DEBUG=1`; lokal na mase-save ang raw/filtered masks at track
measurements sa `state/motion-debug/`. Huwag iwanang naka-enable ang debug
mode sa shared na farmer workstation.
