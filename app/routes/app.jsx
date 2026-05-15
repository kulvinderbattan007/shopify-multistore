// import { Outlet, useLoaderData, useRouteError } from "react-router";
// import { boundary } from "@shopify/shopify-app-react-router/server";
// import { AppProvider } from "@shopify/shopify-app-react-router/react";
// import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   await authenticate.admin(request);

//   // eslint-disable-next-line no-undef
//   return { apiKey: process.env.SHOPIFY_API_KEY || "" };
// };

// export default function App() {
//   const { apiKey } = useLoaderData(); 

//   return (
//     <AppProvider embedded apiKey={apiKey}>
//       <s-app-nav>
//         <s-link href="/app">About</s-link>
//         {/* <s-link href="/app/additional">Additional page tyest</s-link>
//         <s-link href="/app/discount">Discount</s-link>  */}
//         {/* <s-link href="/app/productbanner">Product Banner</s-link> */}
//         <s-link href="/app/volumediscount">Discount Rules</s-link>
//         <s-link href="/app/faq">Faq</s-link>

//         <s-link href="/app/plan">Plan</s-link>
//         <s-link href="/app/contact">Contact</s-link>




//       </s-app-nav>
//       <Outlet />
//     </AppProvider>
//   );
// }

// // Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
// export function ErrorBoundary() {
//   return boundary.error(useRouteError());
// }

// export const headers = (headersArgs) => {
//   return boundary.headers(headersArgs);
// };

// // import { Outlet, useLoaderData, useRouteError } from "react-router";
// // import { AppProvider } from "@shopify/shopify-app-react-router/react";

// // export const loader = async ({ request }) => {
// //   return { apiKey: process.env.SHOPIFY_API_KEY || "" };
// // };

// // export default function App() {
// //   const { apiKey } = useLoaderData();

// //   return (
// //     <AppProvider embedded apiKey={apiKey}>
// //       <s-app-nav>
// //         <s-link href="/app">About</s-link>
// //         <s-link href="/app/volumediscount">Discount Rules</s-link>
// //         <s-link href="/app/faq">Faq</s-link>
// //         <s-link href="/app/plan">Plan</s-link>
// //         <s-link href="/app/contact">Contact</s-link>
// //       </s-app-nav>
// //       <Outlet />
// //     </AppProvider>
// //   );
// // }

// // export function ErrorBoundary() {
// //   const error = useRouteError();
// //   console.error("App boundary error:", error);
// //   return (
// //     <div style={{ padding: "20px", color: "red" }}>
// //       Something went wrong. Please refresh the page.
// //     </div>
// //   );
// // }

// // export const headers = (headersArgs) => {
// //   return headersArgs.loaderHeaders;
// // };


import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[app.jsx/loader] ROOT LOADER HIT");
  console.log("[app.jsx/loader] Full URL:", request.url);
  console.log("[app.jsx/loader] Pathname:", url.pathname);
  console.log("[app.jsx/loader] shop param:", url.searchParams.get("shop"));
  console.log("[app.jsx/loader] id_token present:", !!url.searchParams.get("id_token"));
  console.log("[app.jsx/loader] hmac present:", !!url.searchParams.get("hmac"));
  console.log("[app.jsx/loader] session param:", url.searchParams.get("session"));
  console.log("[app.jsx/loader] embedded param:", url.searchParams.get("embedded"));
  console.log("[app.jsx/loader] Authorization header:", request.headers.get("Authorization") ? "PRESENT" : "MISSING");
  console.log("[app.jsx/loader] Cookie header:", request.headers.get("cookie") ? "PRESENT" : "MISSING");

  try {
    console.log("[app.jsx/loader] Calling authenticate.admin(request)...");
    await authenticate.admin(request);
    console.log("[app.jsx/loader] ✅ authenticate.admin() succeeded");
  } catch (error) {
    console.log("[app.jsx/loader] ❌ authenticate.admin() threw:", error?.constructor?.name, error?.message);
    console.log("[app.jsx/loader] Re-throwing for Shopify to handle redirect...");
    throw error;
  }

  const apiKey = process.env.SHOPIFY_API_KEY || "";
  console.log("[app.jsx/loader] SHOPIFY_API_KEY present:", !!apiKey);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  return { apiKey };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" rel="home">About</s-link>
        <s-link href="/app/volumediscount">Discount Rules</s-link>
        <s-link href="/app/faq">Faq</s-link>
        <s-link href="/app/plan">Plan</s-link>
        <s-link href="/app/contact">Contact</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};