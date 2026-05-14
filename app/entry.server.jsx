import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;


// ---- Keep-alive ping to prevent Render free instance from sleeping --------
let keepAliveStarted = false;

function startKeepAlivePing() {
  if (keepAliveStarted) return; // prevent multiple intervals on hot reload
  keepAliveStarted = true;

  const PING_URL = "https://shopify-multistore.onrender.com";
  const INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

  setInterval(async () => {
    try {
      const res = await fetch(PING_URL);
      console.log(`[KeepAlive] Pinged ${PING_URL} - Status: ${res.status}`);
    } catch (err) {
      console.error(`[KeepAlive] Ping failed:`, err.message);
    }
  }, INTERVAL_MS);

  console.log("[KeepAlive] Started - pinging every 14 minutes.");
}

startKeepAlivePing();
// --------------------------------------------------------------------------

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
