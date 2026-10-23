# Eseninocafe Pin Board

- `index.html`: the OBS browser source that shows up on stream
- `configure/`: the configure page (open it from GitHub Pages in Chrome)

## Setup

1. Push to GitHub and turn on Pages (Settings → Pages → Deploy from branch → `main`, `/ (root)`).
2. In OBS, add a **Browser** source:
   - URL: `https://<user>.github.io/<repo>/`
   - Width `589`, height `601`, at x `32`, y `184` in the 1920×1080 scene
   - Leave **Shutdown source when not visible** unticked, so it still gets changes while hidden
3. Open `https://<user>.github.io/<repo>/configure/` and paste the WebSocket Server Password once. It's remembered after that.

After pushing an update, give GitHub Pages a few minutes, then reload the configure page and click **Refresh cache of current page** in the browser source's properties.

## Using it

- Right-click inside the dashed box → **Pin image** / **Pin text**. You can also drop an image or paste an image or text.
- Drag a pin to move its note. Click a pin to unpin the note (Cmd/Ctrl+Z puts it back).
- Bottom corners: grab the stroke to resize (images only), or just outside it to rotate.
- Enter makes a new line. Text is saved when you click away (or press Escape).
- Cmd/Ctrl + scroll (or pinch) to zoom.
- Notes always stay fully inside the board, so nothing gets cut off on stream.
- Add `?play` to the configure page's URL to try things out without OBS. Nothing is saved.

The board is stored in OBS (WebSocket persistent data), and the overlay keeps its own copy for when the configure page is closed. Nothing goes to a server.
