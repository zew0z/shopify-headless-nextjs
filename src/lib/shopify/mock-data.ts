import { Product, Collection } from "./types";

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "gid://shopify/Product/1",
    handle: "minimalist-leather-backpack",
    title: "Minimalist Leather Backpack",
    description: "Handcrafted from full-grain vegetable-tanned leather, featuring a padded 16-inch laptop compartment, water-resistant YKK zippers, and breathable ergonomic shoulder straps.",
    descriptionHtml: "<p>Handcrafted from full-grain vegetable-tanned leather, featuring a padded 16-inch laptop compartment, water-resistant YKK zippers, and breathable ergonomic shoulder straps.</p><p>Built for a lifetime of daily commutes and weekend wanderlust.</p>",
    availableForSale: true,
    vendor: "Nordic Goods",
    tags: ["bags", "leather", "bestseller"],
    featuredImage: {
      url: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=1000&auto=format&fit=crop",
      altText: "Minimalist Leather Backpack",
      width: 1000,
      height: 1000,
    },
    images: {
      edges: [
        {
          node: {
            url: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=1000&auto=format&fit=crop",
            altText: "Minimalist Leather Backpack Front",
          },
        },
        {
          node: {
            url: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=1000&auto=format&fit=crop",
            altText: "Backpack interior compartment",
          },
        },
      ],
    },
    priceRange: {
      minVariantPrice: { amount: "185.00", currencyCode: "USD" },
      maxVariantPrice: { amount: "210.00", currencyCode: "USD" },
    },
    compareAtPriceRange: {
      minVariantPrice: { amount: "240.00", currencyCode: "USD" },
    },
    options: [
      { id: "opt-color-1", name: "Color", values: ["Cognac Brown", "Obsidian Black"] },
      { id: "opt-size-1", name: "Size", values: ["15 Liter", "20 Liter"] },
    ],
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/101",
            title: "Cognac Brown / 15 Liter",
            availableForSale: true,
            selectedOptions: [
              { name: "Color", value: "Cognac Brown" },
              { name: "Size", value: "15 Liter" },
            ],
            price: { amount: "185.00", currencyCode: "USD" },
            compareAtPrice: { amount: "240.00", currencyCode: "USD" },
            image: {
              url: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=1000&auto=format&fit=crop",
              altText: "Cognac Brown",
            },
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/102",
            title: "Cognac Brown / 20 Liter",
            availableForSale: true,
            selectedOptions: [
              { name: "Color", value: "Cognac Brown" },
              { name: "Size", value: "20 Liter" },
            ],
            price: { amount: "210.00", currencyCode: "USD" },
            compareAtPrice: { amount: "260.00", currencyCode: "USD" },
            image: {
              url: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa?q=80&w=1000&auto=format&fit=crop",
              altText: "Cognac Brown Large",
            },
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/103",
            title: "Obsidian Black / 15 Liter",
            availableForSale: true,
            selectedOptions: [
              { name: "Color", value: "Obsidian Black" },
              { name: "Size", value: "15 Liter" },
            ],
            price: { amount: "185.00", currencyCode: "USD" },
            image: {
              url: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?q=80&w=1000&auto=format&fit=crop",
              altText: "Obsidian Black",
            },
          },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/2",
    handle: "matte-black-ceramic-mug",
    title: "Artisanal Ceramic Pour-Over Mug",
    description: "Double-walled handmade ceramic mug with a smooth matte exterior and glossy interior glaze. Keeps your coffee piping hot while staying cool to the touch.",
    descriptionHtml: "<p>Double-walled handmade ceramic mug with a smooth matte exterior and glossy interior glaze.</p>",
    availableForSale: true,
    vendor: "Kinto Studio",
    tags: ["home", "coffee", "ceramic"],
    featuredImage: {
      url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=1000&auto=format&fit=crop",
      altText: "Artisanal Ceramic Mug",
      width: 1000,
      height: 1000,
    },
    images: {
      edges: [
        {
          node: {
            url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=1000&auto=format&fit=crop",
            altText: "Artisanal Ceramic Mug",
          },
        },
      ],
    },
    priceRange: {
      minVariantPrice: { amount: "32.00", currencyCode: "USD" },
      maxVariantPrice: { amount: "32.00", currencyCode: "USD" },
    },
    options: [
      { id: "opt-color-2", name: "Color", values: ["Matte Charcoal", "Sand White"] },
    ],
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/201",
            title: "Matte Charcoal",
            availableForSale: true,
            selectedOptions: [{ name: "Color", value: "Matte Charcoal" }],
            price: { amount: "32.00", currencyCode: "USD" },
          },
        },
        {
          node: {
            id: "gid://shopify/ProductVariant/202",
            title: "Sand White",
            availableForSale: true,
            selectedOptions: [{ name: "Color", value: "Sand White" }],
            price: { amount: "32.00", currencyCode: "USD" },
          },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/3",
    handle: "wireless-noise-cancelling-headphones",
    title: "Aura ANC Studio Headphones",
    description: "Engineered with custom 40mm bio-cellulose drivers, 38-hour battery reserve, spatial audio, and premium memory foam lambskin earpads for fatigue-free listening.",
    descriptionHtml: "<p>Engineered with custom 40mm bio-cellulose drivers, 38-hour battery reserve, spatial audio, and premium memory foam lambskin earpads.</p>",
    availableForSale: true,
    vendor: "Aura Sound",
    tags: ["audio", "tech", "premium"],
    featuredImage: {
      url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=1000&auto=format&fit=crop",
      altText: "Aura ANC Studio Headphones",
      width: 1000,
      height: 1000,
    },
    images: {
      edges: [
        {
          node: {
            url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=1000&auto=format&fit=crop",
            altText: "Aura ANC Studio Headphones",
          },
        },
      ],
    },
    priceRange: {
      minVariantPrice: { amount: "299.00", currencyCode: "USD" },
      maxVariantPrice: { amount: "299.00", currencyCode: "USD" },
    },
    compareAtPriceRange: {
      minVariantPrice: { amount: "349.00", currencyCode: "USD" },
    },
    options: [
      { id: "opt-color-3", name: "Finish", values: ["Space Gray", "Silver Cream"] },
    ],
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/301",
            title: "Space Gray",
            availableForSale: true,
            selectedOptions: [{ name: "Finish", value: "Space Gray" }],
            price: { amount: "299.00", currencyCode: "USD" },
            compareAtPrice: { amount: "349.00", currencyCode: "USD" },
          },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/4",
    handle: "mechanical-mechanical-keyboard",
    title: "Precision Anodized Aluminum Keyboard",
    description: "Compact 75% hot-swappable mechanical keyboard milled from a solid billet of 6063 aluminum. Features pre-lubed tactile switches and south-facing RGB.",
    descriptionHtml: "<p>Compact 75% hot-swappable mechanical keyboard milled from solid 6063 aluminum.</p>",
    availableForSale: true,
    vendor: "Keycraft Co",
    tags: ["workspace", "tech"],
    featuredImage: {
      url: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?q=80&w=1000&auto=format&fit=crop",
      altText: "Mechanical Keyboard",
      width: 1000,
      height: 1000,
    },
    images: {
      edges: [
        {
          node: {
            url: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?q=80&w=1000&auto=format&fit=crop",
            altText: "Mechanical Keyboard",
          },
        },
      ],
    },
    priceRange: {
      minVariantPrice: { amount: "165.00", currencyCode: "USD" },
      maxVariantPrice: { amount: "185.00", currencyCode: "USD" },
    },
    options: [
      { id: "opt-switch-4", name: "Switch Type", values: ["Tactile Mint", "Linear Cocoa"] },
    ],
    variants: {
      edges: [
        {
          node: {
            id: "gid://shopify/ProductVariant/401",
            title: "Tactile Mint",
            availableForSale: true,
            selectedOptions: [{ name: "Switch Type", value: "Tactile Mint" }],
            price: { amount: "165.00", currencyCode: "USD" },
          },
        },
      ],
    },
  },
];

export const MOCK_COLLECTIONS: Collection[] = [
  {
    id: "gid://shopify/Collection/1",
    handle: "featured",
    title: "Featured Essentials",
    description: "Carefully curated products built with longevity and craft.",
    image: {
      url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?q=80&w=1000&auto=format&fit=crop",
      altText: "Featured Essentials",
    },
  },
  {
    id: "gid://shopify/Collection/2",
    handle: "workspace",
    title: "Workspace & Audio",
    description: "Elevate your daily focus with precision instruments.",
    image: {
      url: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?q=80&w=1000&auto=format&fit=crop",
      altText: "Workspace & Audio",
    },
  },
];
