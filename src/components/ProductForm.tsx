"use client";

import { useState } from "react";
import { Product, ProductVariant } from "@/lib/shopify/types";
import { useCart } from "@/context/cart-context";
import { ShoppingBag, Check } from "lucide-react";
import { formatMoney } from "@/lib/shopify/money";

interface ProductFormProps {
  product: Product;
}

export function ProductForm({ product }: ProductFormProps) {
  const { addItem } = useCart();
  const variants = product.variants.edges.map((e) => e.node);

  // Default to first variant
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant>(
    variants[0] || ({} as ProductVariant)
  );
  const [quantity, setQuantity] = useState(1);
  const [isAdded, setIsAdded] = useState(false);

  // Current selections for each option
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (selectedVariant.selectedOptions) {
      selectedVariant.selectedOptions.forEach((opt) => {
        initial[opt.name] = opt.value;
      });
    }
    return initial;
  });

  const handleOptionChange = (optionName: string, value: string) => {
    const updatedOptions = { ...selectedOptions, [optionName]: value };
    setSelectedOptions(updatedOptions);

    // Find matching variant
    const matched = variants.find((variant) =>
      variant.selectedOptions.every(
        (opt) => updatedOptions[opt.name] === opt.value
      )
    );

    if (matched) {
      setSelectedVariant(matched);
    }
  };

  const handleAddToCart = async () => {
    if (!selectedVariant.id) return;
    await addItem(selectedVariant, product, quantity);
    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);
  };

  const price = selectedVariant.price ?? product.priceRange.minVariantPrice;
  const compareAtPrice = selectedVariant.compareAtPrice;

  return (
    <div className="space-y-6">
      {/* Price Display */}
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">
          {formatMoney(price)}
        </span>
        {compareAtPrice && Number(compareAtPrice.amount) > Number(price.amount) && (
          <span className="text-lg text-neutral-400 line-through">
            {formatMoney(compareAtPrice)}
          </span>
        )}
      </div>

      {/* Options Selector */}
      {product.options.map((option) => (
        <div key={option.id} className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
            {option.name}: <span className="font-normal text-neutral-500">{selectedOptions[option.name]}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {option.values.map((val) => {
              const isSelected = selectedOptions[option.name] === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleOptionChange(option.name, val)}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                    isSelected
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-sm"
                      : "border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  }`}
                >
                  {val}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Quantity Selector */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
          Quantity
        </label>
        <div className="flex w-32 items-center rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="p-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-l-xl transition-colors"
          >
            -
          </button>
          <span className="flex-1 text-center text-sm font-semibold">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity(quantity + 1)}
            className="p-2.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-r-xl transition-colors"
          >
            +
          </button>
        </div>
      </div>

      {/* Add To Cart CTA */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={!selectedVariant.availableForSale}
          className={`w-full flex items-center justify-center gap-2 rounded-2xl py-4 px-6 text-sm font-semibold shadow-lg transition-all ${
            isAdded
              ? "bg-emerald-600 text-white"
              : selectedVariant.availableForSale
              ? "bg-neutral-900 text-white hover:bg-neutral-800 hover:scale-[1.01] dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              : "bg-neutral-200 text-neutral-400 cursor-not-allowed dark:bg-neutral-800"
          }`}
        >
          {isAdded ? (
            <>
              <Check className="h-5 w-5" />
              <span>Added to Bag!</span>
            </>
          ) : selectedVariant.availableForSale ? (
            <>
              <ShoppingBag className="h-5 w-5" />
              <span>Add to Bag</span>
            </>
          ) : (
            <span>Sold Out</span>
          )}
        </button>
      </div>

    </div>
  );
}
