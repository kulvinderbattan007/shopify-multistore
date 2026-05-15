// import { Outlet, useLoaderData, useRouteError } from "react-router";
// import { boundary } from "@shopify/shopify-app-react-router/server";
// import { AppProvider } from "@shopify/shopify-app-react-router/react";
// // import { authenticate } from "../shopify.server";

// export const loader = async ({ request }) => {
//   // await authenticate.admin(request);

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

import { Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

export const loader = async ({ request }) => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">About</s-link>
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
  const error = useRouteError();
  console.error("App boundary error:", error);
  return (
    <div style={{ padding: "20px", color: "red" }}>
      Something went wrong. Please refresh the page.
    </div>
  );
}

export const headers = (headersArgs) => {
  return headersArgs.loaderHeaders;
};