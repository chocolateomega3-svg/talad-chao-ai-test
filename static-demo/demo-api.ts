import { initialData } from "../db/seed";
import type { AppData, StateAction, StatePayload } from "../app/lib/types";

const STORAGE_KEY = "talad-chao-ai-test-static-state-v1";

type StoredState = StatePayload;

function cloneSeed(): AppData {
  return JSON.parse(JSON.stringify(initialData)) as AppData;
}

function normalizeProductName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
}

function readState(): StoredState {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as StoredState;
      if (
        stored &&
        typeof stored.version === "number" &&
        typeof stored.updatedAt === "string" &&
        Array.isArray(stored.data?.products) &&
        Array.isArray(stored.data?.customers) &&
        Array.isArray(stored.data?.sales) &&
        Array.isArray(stored.data?.expenses)
      ) {
        return stored;
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  const seeded: StoredState = {
    data: cloneSeed(),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function applyAction(data: AppData, action: StateAction): AppData {
  if (action.type === "state.restore") {
    return JSON.parse(JSON.stringify(action.data)) as AppData;
  }
  if (action.type === "sale.create") {
    return { ...data, sales: [...data.sales, action.sale] };
  }
  if (action.type === "sale.toggle") {
    return {
      ...data,
      sales: data.sales.map((sale) =>
        sale.id === action.id ? { ...sale, paid: !sale.paid } : sale,
      ),
    };
  }
  if (action.type === "sale.setPaid") {
    const ids = new Set(action.ids);
    return {
      ...data,
      sales: data.sales.map((sale) =>
        ids.has(sale.id) ? { ...sale, paid: action.paid } : sale,
      ),
    };
  }
  if (action.type === "sale.delete") {
    return { ...data, sales: data.sales.filter((sale) => sale.id !== action.id) };
  }
  if (action.type === "product.create") {
    const product = action.product;
    const name = product.name.trim().replace(/\s+/g, " ");
    if (!name || !Number.isFinite(product.price) || product.price <= 0) {
      throw new Error("กรุณากรอกชื่อ หน่วย และราคาสินค้าให้ถูกต้อง");
    }
    if (
      data.products.some(
        (item) => normalizeProductName(item.name) === normalizeProductName(name),
      )
    ) {
      throw new Error(`มีสินค้า “${name}” อยู่แล้ว กรุณาใช้ชื่ออื่น`);
    }
    return {
      ...data,
      products: [...data.products, { ...product, name, cost: product.cost ?? null }],
    };
  }
  if (action.type === "product.update") {
    const name = action.name.trim();
    if (!name || !Number.isFinite(action.price) || action.price <= 0) {
      throw new Error("กรุณากรอกชื่อ หน่วย และราคาสินค้าให้ถูกต้อง");
    }
    if (
      data.products.some(
        (item) =>
          item.id !== action.id &&
          normalizeProductName(item.name) === normalizeProductName(name),
      )
    ) {
      throw new Error(`มีสินค้า “${name}” อยู่แล้ว กรุณาใช้ชื่ออื่น`);
    }
    return {
      ...data,
      products: data.products.map((product) =>
        product.id === action.id
          ? {
              ...product,
              name,
              unit: action.unit,
              price: action.price,
              cost: action.cost ?? null,
            }
          : product,
      ),
    };
  }
  if (action.type === "product.upsert") {
    const index = data.products.findIndex(
      (product) =>
        product.id === action.product.id ||
        normalizeProductName(product.name) ===
          normalizeProductName(action.product.name),
    );
    if (index < 0) {
      return { ...data, products: [...data.products, action.product] };
    }
    return {
      ...data,
      products: data.products.map((product, productIndex) =>
        productIndex === index
          ? { ...action.product, id: product.id }
          : product,
      ),
    };
  }
  if (action.type === "customer.create") {
    return { ...data, customers: [...data.customers, action.customer] };
  }
  if (action.type === "customer.update") {
    return {
      ...data,
      customers: data.customers.map((customer) =>
        customer.id === action.id
          ? { ...customer, [action.field]: action.value }
          : customer,
      ),
    };
  }
  if (action.type === "customer.updateDetails") {
    const name = action.name.trim();
    if (!name) throw new Error("กรุณากรอกชื่อลูกค้า");
    return {
      ...data,
      customers: data.customers.map((customer) =>
        customer.id === action.id
          ? {
              ...customer,
              name,
              phone: action.phone.trim(),
              note: action.note.trim(),
            }
          : customer,
      ),
    };
  }
  if (action.type === "customer.move") {
    const ordered = [...data.customers].sort(
      (a, b) => a.routeOrder - b.routeOrder,
    );
    const currentIndex = ordered.findIndex((customer) => customer.id === action.id);
    const destinationIndex =
      currentIndex + (action.direction === "up" ? -1 : 1);
    if (
      currentIndex < 0 ||
      destinationIndex < 0 ||
      destinationIndex >= ordered.length
    ) {
      return data;
    }
    const current = ordered[currentIndex];
    const destination = ordered[destinationIndex];
    return {
      ...data,
      customers: data.customers.map((customer) => {
        if (customer.id === current.id) {
          return { ...customer, routeOrder: destination.routeOrder };
        }
        if (customer.id === destination.id) {
          return { ...customer, routeOrder: current.routeOrder };
        }
        return customer;
      }),
    };
  }
  if (action.type === "expense.create") {
    return { ...data, expenses: [...data.expenses, action.expense] };
  }
  return {
    ...data,
    expenses: data.expenses.filter((expense) => expense.id !== action.id),
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function installDemoApi() {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? new URL(input, window.location.href)
        : input instanceof URL
          ? input
          : new URL(input.url, window.location.href);

    if (url.origin !== window.location.origin || url.pathname !== "/api/state") {
      return nativeFetch(input, init);
    }

    try {
      if ((init?.method ?? "GET").toUpperCase() === "GET") {
        return jsonResponse(readState());
      }

      const action = JSON.parse(String(init?.body ?? "{}")) as StateAction;
      const current = readState();
      const next: StoredState = {
        data: applyAction(current.data, action),
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(next),
        }),
      );
      return jsonResponse(next);
    } catch (error) {
      return jsonResponse(
        {
          ...readState(),
          error: error instanceof Error ? error.message : "บันทึกข้อมูลทดสอบไม่สำเร็จ",
        },
        400,
      );
    }
  };
}
