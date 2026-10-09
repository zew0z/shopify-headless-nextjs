/** Browser-safe cart API client. Credentials and cart access keys live on the server. */
export function createCartClient(endpoint = "/api/cart", fetchFn: typeof fetch = fetch) {
  let queue: Promise<unknown> = Promise.resolve();
  const send = (data: Record<string, unknown>) => {
    const operation = queue.then(async () => {
      const response = await fetchFn(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Cart action failed");
      return body;
    });
    queue = operation.catch(() => undefined);
    return operation;
  };
  return {
    get: () => send({ action: "get" }),
    add: (merchandiseId: string, quantity = 1) => send({ action: "add", merchandiseId, quantity }),
    update: (lineId: string, quantity: number) => send({ action: "update", lineId, quantity }),
    remove: (lineId: string) => send({ action: "remove", lineId }),
    discount: (code: string) => send({ action: "discount", code }),
    checkout: () => send({ action: "checkout" }),
  };
}
