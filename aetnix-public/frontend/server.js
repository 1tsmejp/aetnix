import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const apiBaseUrl = process.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.join(__dirname, 'src');

app.use('/src', express.static(srcDir, { extensions: ['js', 'css'] }));
app.use('/vendor/react', express.static(path.join(__dirname, 'node_modules/react/umd')));
app.use('/vendor/react-dom', express.static(path.join(__dirname, 'node_modules/react-dom/umd')));

app.get('*', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AETNIX</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #0b1220; color: #e5eefc; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      a { color: inherit; }
      button, input, select, textarea { font: inherit; }
    </style>
    <script>
      window.__AETNIX_CONFIG__ = ${JSON.stringify({ apiBaseUrl })};
      window.__NORTON_CONFIG__ = window.__AETNIX_CONFIG__;
    </script>
    <script src="/vendor/react/react.development.js"></script>
    <script src="/vendor/react-dom/react-dom.development.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client.js"></script>
  </body>
</html>`);
});

app.listen(port, () => {
  console.log(`Frontend listening on port ${port}`);
});
