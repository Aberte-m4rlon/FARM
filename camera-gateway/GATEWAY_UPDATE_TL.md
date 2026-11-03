# Camera gate line update

Palitan lang ang `gateway.py`, `inference.py`, at `flow_counter.py` sa kasalukuyang `camera-gateway` folder gamit ang mga kaparehong file mula sa ZIP na ito. Huwag palitan ang `.env`, camera credentials, private model weights, o `state/camera-flow-counts.json`.

Pagkatapos kopyahin, buksan ang PowerShell sa folder na may `gateway.py` at patakbuhin:

```powershell
.\.venv\Scripts\python.exe gateway.py
```

Kailangan may internet ang gateway laptop at pareho ang `ALPASFARM_API_URL` at `CAMERA_GATEWAY_TOKEN` sa nakatakda para sa live VPS. Kapag tumatakbo na ito, i-drag ang pulang linya sa live camera o gamitin ang slider. Ang direksyon ng pasok ay puwede ring baguhin sa camera page. Makikita ang bounding boxes kapag nakakita ang model ng kambing o tupa.
