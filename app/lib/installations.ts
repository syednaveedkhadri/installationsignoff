export type InstallationProduct = {
  productName: string;
  serialNumber: string;
};

export type InstallationOrder = {
  orderNumber: string;
  products: InstallationProduct[];
  installationAddress: string;
  installationDate: string;
  technicianName: string;
};

export type InstallationSubmission = {
  installationId: string;
  customerName: string;
  phoneNumber: string;
  rating: number;
  serviceComment: string;
  products: InstallationProduct[];
  signatureImage: string;
  submittedAt: string;
};

const ordersStorageKey = "installation-orders";
const submissionsStorageKey = "installation-confirmation-submissions";
const installationStorageEvent = "installation-storage-change";

function notifyInstallationStorageChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(installationStorageEvent));
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeProducts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((product) => {
      if (!product || typeof product !== "object") {
        return null;
      }

      const productRecord = product as Record<string, unknown>;
      const productName = asString(productRecord.productName).trim();
      const serialNumber = asString(productRecord.serialNumber).trim();

      if (!productName && !serialNumber) {
        return null;
      }

      return { productName, serialNumber };
    })
    .filter((product): product is InstallationProduct => product !== null);
}

function normalizeOrder(value: unknown): InstallationOrder | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const orderRecord = value as Record<string, unknown>;
  const orderNumber = asString(orderRecord.orderNumber).trim();

  if (!orderNumber) {
    return null;
  }

  const products = normalizeProducts(orderRecord.products);
  const legacyProductName = asString(orderRecord.productName).trim();
  const legacySerialNumber = asString(orderRecord.serialNumber).trim();

  return {
    orderNumber,
    products:
      products.length > 0
        ? products
        : [
            {
              productName: legacyProductName,
              serialNumber: legacySerialNumber,
            },
          ],
    installationAddress: asString(orderRecord.installationAddress).trim(),
    installationDate: asString(orderRecord.installationDate).trim(),
    technicianName: asString(orderRecord.technicianName).trim(),
  };
}

function normalizeSubmission(value: unknown): InstallationSubmission | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const submissionRecord = value as Record<string, unknown>;
  const installationId = asString(submissionRecord.installationId).trim();

  if (!installationId) {
    return null;
  }

  return {
    installationId,
    customerName: asString(submissionRecord.customerName).trim(),
    phoneNumber: asString(submissionRecord.phoneNumber).trim(),
    rating:
      typeof submissionRecord.rating === "number"
        ? submissionRecord.rating
        : Number(submissionRecord.rating) || 0,
    serviceComment: asString(submissionRecord.serviceComment),
    products: normalizeProducts(submissionRecord.products),
    signatureImage: asString(submissionRecord.signatureImage),
    submittedAt: asString(submissionRecord.submittedAt),
  };
}

export function subscribeToInstallationStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(installationStorageEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(installationStorageEvent, onStoreChange);
  };
}

export function getOrders(): InstallationOrder[] {
  const storedOrders = localStorage.getItem(ordersStorageKey);

  if (!storedOrders) {
    return [];
  }

  try {
    const parsedOrders = JSON.parse(storedOrders);

    if (!Array.isArray(parsedOrders)) {
      return [];
    }

    return parsedOrders
      .map(normalizeOrder)
      .filter((order): order is InstallationOrder => order !== null);
  } catch {
    return [];
  }
}

export function getOrderByNumber(orderNumber: string) {
  return getOrders().find((order) => order.orderNumber === orderNumber) ?? null;
}

export function saveOrder(order: InstallationOrder) {
  const orders = getOrders();
  const otherOrders = orders.filter(
    (savedOrder) => savedOrder.orderNumber !== order.orderNumber,
  );

  localStorage.setItem(ordersStorageKey, JSON.stringify([...otherOrders, order]));
  notifyInstallationStorageChange();
}

export function getSubmissions(): InstallationSubmission[] {
  const storedSubmissions = localStorage.getItem(submissionsStorageKey);

  if (!storedSubmissions) {
    return [];
  }

  try {
    const parsedSubmissions = JSON.parse(storedSubmissions);

    if (!Array.isArray(parsedSubmissions)) {
      return [];
    }

    return parsedSubmissions
      .map(normalizeSubmission)
      .filter(
        (submission): submission is InstallationSubmission =>
          submission !== null,
      );
  } catch {
    return [];
  }
}

export function saveSubmission(submission: InstallationSubmission) {
  const submissions = getSubmissions();
  const alreadySubmitted = submissions.some(
    (savedSubmission) =>
      savedSubmission.installationId === submission.installationId,
  );

  if (alreadySubmitted) {
    return false;
  }

  localStorage.setItem(
    submissionsStorageKey,
    JSON.stringify([...submissions, submission]),
  );
  notifyInstallationStorageChange();

  return true;
}
