# KRISP KDS

Reconstructed Android project from the working KRISP v0.3.0 recovery baseline.

## v0.3.1
- Horizontal touch/swipe rail for active tickets.
- Version moved into the app header below the Android status bar.
- P18 raw print receiver: Kitchen 9100, Bar 9101, Salad 9102, Dessert 9103.
- Epson discovery listener on UDP 3289.
- Existing KRISP parser/order workflow preserved from recovered v0.3.0 web assets.

Known working P18 workflow: **Ring order → Save → Take Out → one KRISP ticket.** Avoid Precheck for normal KDS sending because it creates a separate print event.


## Build 3
- Fix native status field so tablet Wi-Fi IP is displayed.
- Bind Epson discovery on UDP 3289 with reuse enabled and clearer diagnostics.
- Preserve TCP 9100 kitchen receiver.
- Add native KRISP launcher icon.
- Visible Build 3 marker.

Important: only one KRISP app can own TCP 9100 at a time. Force-stop v0.3.0 before testing Build 3, but keep it installed as fallback.
