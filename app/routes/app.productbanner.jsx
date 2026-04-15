import { useLoaderData, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// 🔹 LOADER
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("q") || "";

  if (searchQuery) {
    const response = await admin.graphql(
      `#graphql
      query SearchProducts($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { query: searchQuery } }
    );

    const json = await response.json();
    return { products: json.data?.products?.edges || [] };
  }

  return { products: [] };
}

// 🔹 ACTION
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "UPLOAD_IMAGE") {
    const productId = formData.get("productId");
    const imageFile = formData.get("image");

    if (!productId || !imageFile) {
      return { error: "Product ID and image are required" };
    }

    try {
      // 1️⃣ Create a staged upload
      // IMPORTANT: input is [StagedUploadInput!]!, so we pass an ARRAY.
      const stagedUploadResponse = await admin.graphql(
        `#graphql
        mutation StagedUploadCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters {
                name
                value
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            input: [
              {
                filename: imageFile.name,
                mimeType: imageFile.type,
                httpMethod: "POST",
                resource: "IMAGE",
                // Optional for images, required for some resources:
                // fileSize: imageFile.size,
              },
            ],
          },
        }
      );

      const stagedJson = await stagedUploadResponse.json();
      const stagedErrors =
        stagedJson.data?.stagedUploadsCreate?.userErrors || [];
      if (stagedErrors.length > 0) {
        throw new Error(
          "Staged upload error: " +
            stagedErrors.map((e) => e.message).join(", ")
        );
      }

      const stagedTarget =
        stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];

      if (!stagedTarget) {
        throw new Error("Failed to create staged upload");
      }

      // 2️⃣ Upload the file to the staged URL
      const uploadFormData = new FormData();
      stagedTarget.parameters.forEach(({ name, value }) => {
        uploadFormData.append(name, value);
      });
      uploadFormData.append("file", imageFile);

      const uploadResponse = await fetch(stagedTarget.url, {
        method: "POST",
        body: uploadFormData,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file");
      }

      // 3️⃣ Create file reference (File object in Shopify)
      const fileCreateResponse = await admin.graphql(
        `#graphql
        mutation FileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              # File is a union; we need fragments to pull URLs
              ... on GenericFile {
                url
              }
              ... on MediaImage {
                image {
                  url
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            files: [
              {
                originalSource: stagedTarget.resourceUrl,
                contentType: "IMAGE",
              },
            ],
          },
        }
      );

      const fileJson = await fileCreateResponse.json();
      const fileErrors = fileJson.data?.fileCreate?.userErrors || [];
      if (fileErrors.length > 0) {
        throw new Error(
          "File create error: " +
            fileErrors.map((e) => e.message).join(", ")
        );
      }

      const file = fileJson.data?.fileCreate?.files?.[0];

      if (!file) {
        throw new Error("Failed to create file reference");
      }

      // Decide on a URL to send back to the UI
      let imageUrl = null;
      if (file.image?.url) {
        imageUrl = file.image.url;
      } else if (file.url) {
        imageUrl = file.url;
      }

      // 4️⃣ Set metafield (file_reference) on the product
      const metafieldResponse = await admin.graphql(
        `#graphql
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
              value
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                ownerId: productId,
                namespace: "custom_product_banner",
                key: "banner_image",
                type: "file_reference",
                value: file.id, // file GID
              },
            ],
          },
        }
      );

      const metafieldJson = await metafieldResponse.json();
      const errors = metafieldJson.data?.metafieldsSet?.userErrors || [];

      if (errors.length > 0) {
        throw new Error(errors.map((e) => e.message).join(", "));
      }

      return { success: true, imageUrl };
    } catch (error) {
      return { error: error.message };
    }
  }

  return { error: "Invalid action" };
}

// 🔹 COMPONENT
export default function ProductBannerPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedProductForImage, setSelectedProductForImage] = useState(null);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.search = `?q=${encodeURIComponent(searchQuery)}`;
    }
  };

  const handleSelectProduct = (product) => {
    
    if (!selectedProducts.find((p) => p.id === product.id)) {
      setSelectedProducts([...selectedProducts, product]);
    }
  };

  const handleRemoveProduct = (productId) => {
    setSelectedProducts(selectedProducts.filter((p) => p.id !== productId));
  };

  const handleImageUpload = (productId, file) => {
    const formData = new FormData();
    formData.append("actionType", "UPLOAD_IMAGE");
    formData.append("productId", productId);
    formData.append("image", file);

    fetcher.submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Image uploaded successfully!");
      setSelectedProductForImage(null);
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  return (
    <div style={{ padding: "20px" }}>
      <h2>Product Banner Manager</h2>

      {/* Search Form */}
      <form onSubmit={handleSearch} style={{ marginBottom: "20px" }}>
        <input
          type="text"
          placeholder="Search products..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ padding: "8px", width: "300px", marginRight: "10px" }}
        />
        <button type="submit">Search</button>
      </form>

      {/* Search Results */}
      {data.products.length > 0 && (
        <div style={{ marginBottom: "20px" }}>
          <h3>Search Results</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {data.products.map(({ node: product }) => (
              <div
                key={product.id}
                style={{
                  border: "1px solid #ccc",
                  padding: "10px",
                  cursor: "pointer",
                  width: "200px",
                }}
                onClick={() => handleSelectProduct(product)}
              >
                {product.images.edges[0] && (
                  <img
                    src={product.images.edges[0].node.url}
                    alt={product.title}
                    style={{ width: "100%", height: "150px", objectFit: "cover" }}
                  />
                )}
                <p>{product.title}</p>
                <button type="button">Select</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Products */}
      {selectedProducts.length > 0 && (
        <div>
          <h3>Selected Products</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            {selectedProducts.map((product) => (
              <div
                key={product.id}
                style={{
                  border: "1px solid #ccc",
                  padding: "10px",
                  width: "200px",
                  position: "relative",
                }}
              >
                <button
                  type="button"
                  onClick={() => handleRemoveProduct(product.id)}
                  style={{
                    position: "absolute",
                    top: "5px",
                    right: "5px",
                    background: "red",
                    color: "white",
                    border: "none",
                    borderRadius: "50%",
                    width: "20px",
                    height: "20px",
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
                {product.images.edges[0] && (
                  <img
                    src={product.images.edges[0].node.url}
                    alt={product.title}
                    style={{ width: "100%", height: "150px", objectFit: "cover" }}
                  />
                )}
                <p>{product.title}</p>
                <button
                  type="button"
                  onClick={() => setSelectedProductForImage(product)}
                >
                  Upload Banner Image
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Image Upload Modal */}
      {selectedProductForImage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              width: "400px",
            }}
          >
            <h3>Upload Banner Image for {selectedProductForImage.title}</h3>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  handleImageUpload(selectedProductForImage.id, file);
                }
              }}
            />
            <div style={{ marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => setSelectedProductForImage(null)}
                style={{ marginRight: "10px" }}
              >
                Cancel
              </button>
              {fetcher.state === "submitting" && <span>Uploading...</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 