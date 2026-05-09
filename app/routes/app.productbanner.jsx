import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

// 🔹 LOADER
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // 🔹 Get current app functions
  const functionsResponse = await admin.graphql(`
    #graphql
    query {
      currentAppInstallation {
        app {
          id
          title
        }
      }

      shopifyFunctions(first: 50) {
        nodes {
          id
          title
          apiType
          description
          app {
            id
            title
          }
        }
      }
    }
  `);

  const functionsJson = await functionsResponse.json();

  const currentAppId =
    functionsJson.data.currentAppInstallation.app.id;

  // 🔹 Only current app functions
  const functions =
    functionsJson.data.shopifyFunctions.nodes.filter(
      (fn) => fn.app?.id === currentAppId
    );

  // 🔹 GET ALL DISCOUNT TYPES
const discountsResponse = await admin.graphql(`
  #graphql
  query {
    discountNodes(first: 20) {
      edges {
        node {
          id
          __typename

          discount {
            __typename

            ... on DiscountCodeBasic {
              title
              summary
              status
            }

            ... on DiscountAutomaticBasic {
              title
              summary
              status
            }

            ... on DiscountCodeBxgy {
              title
              summary
              status
            }

            ... on DiscountAutomaticBxgy {
              title
              summary
              status
            }

            ... on DiscountCodeFreeShipping {
              title
              summary
              status
            }

            ... on DiscountAutomaticApp {
              title
              status

              appDiscountType {
                functionId
              }
            }
          }
        }
      }
    }
  }
`);

const discountsJson = await discountsResponse.json();

const discounts =
  discountsJson.data?.discountNodes?.edges || [];

  // 🔹 GET CURRENT APP INSTALLATION DETAILS
const appResponse = await admin.graphql(`
  #graphql
  query {
    currentAppInstallation {
      app {
        id
        title
      }

      accessScopes {
        handle
      }
    }
  }
`);

const appJson = await appResponse.json();

const currentAppInstallation =
  appJson.data?.currentAppInstallation || {};

  return {
    functions,
    discounts,
    currentAppInstallation
  };
}

// 🔹 COMPONENT
export default function ProductBannerPage() {
  const data = useLoaderData();

  return (
    <div style={{ padding: "20px" }}>
      {/* 🔹 FUNCTIONS */}
      <div style={{ marginBottom: "40px" }}>
        <h2>Current App Shopify Functions</h2>

        <div
          style={{
            background: "#111",
            color: "#0f0",
            padding: "20px",
            borderRadius: "10px",
            overflowX: "auto",
            marginTop: "20px",
          }}
        >
          <pre>
            {JSON.stringify(data.functions, null, 2)}
          </pre>
        </div>
      </div>

      {/* 🔹 DISCOUNTS */}
      <div>
        <h2>Automatic Discounts</h2>

        <div
          style={{
            background: "#111",
            color: "#0ff",
            padding: "20px",
            borderRadius: "10px",
            overflowX: "auto",
            marginTop: "20px",
          }}
        >
          <pre>
            {/* {JSON.stringify(data.discounts, null, 2)} */}
             {JSON.stringify(data.discounts, null, 2)}
          </pre>
        </div>
      </div>

      <div style={{ marginTop: "40px" }}>
  <h2>Current App Installation</h2>

  <div
    style={{
      background: "#111",
      color: "#0ff",
      padding: "20px",
      borderRadius: "10px",
      overflowX: "auto",
    }}
  >
    <pre>
      {JSON.stringify(
        data.currentAppInstallation,
        null,
        2
      )}
    </pre>
  </div>
</div>
    </div>
  );
}