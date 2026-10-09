import { createCartEndpoint } from "../../lib/shopify/astro";
import { commerce } from "../../fixture";
export const prerender = false;
const endpoint = createCartEndpoint(commerce);
export const GET = endpoint;
export const POST = endpoint;
