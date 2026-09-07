import Link from "next/link";
import { Sparkles, ShieldCheck, Truck, RefreshCw } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 mt-auto">
      {/* Value props banner */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 border-b border-neutral-200 dark:border-neutral-800">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 text-center sm:text-left">
          <div className="flex items-center justify-center sm:justify-start gap-4">
            <div className="rounded-xl bg-neutral-100 p-2.5 dark:bg-neutral-900 text-neutral-900 dark:text-white">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Worldwide Shipping</h4>
              <p className="text-xs text-neutral-500">Tracked delivery direct to your doorstep</p>
            </div>
          </div>

          <div className="flex items-center justify-center sm:justify-start gap-4">
            <div className="rounded-xl bg-neutral-100 p-2.5 dark:bg-neutral-900 text-neutral-900 dark:text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Shopify Secure Checkout</h4>
              <p className="text-xs text-neutral-500">256-bit encrypted payment processing</p>
            </div>
          </div>

          <div className="flex items-center justify-center sm:justify-start gap-4">
            <div className="rounded-xl bg-neutral-100 p-2.5 dark:bg-neutral-900 text-neutral-900 dark:text-white">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">30-Day Guarantee</h4>
              <p className="text-xs text-neutral-500">Hassle-free returns & instant refunds</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main footer content */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold tracking-tight text-lg text-neutral-900 dark:text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span>AURA Storefront</span>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-xs text-neutral-500">
            <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              Terms of Service
            </Link>
            <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              Shipping & Returns
            </Link>
            <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">
              Storefront API Docs
            </Link>
          </div>

          <p className="text-xs text-neutral-400">
            &copy; {new Date().getFullYear()} Aura Commerce. Powered by Shopify Headless.
          </p>
        </div>
      </div>
    </footer>
  );
}
