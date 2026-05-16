"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import {
  getOrders,
  getSubmissions,
  saveOrder,
  subscribeToInstallationStorage,
} from "../lib/installations";
import type {
  InstallationOrder,
  InstallationProduct,
  InstallationSubmission,
} from "../lib/installations";

type OrderFieldKey =
  | "orderNumber"
  | "installationAddress"
  | "installationDate"
  | "technicianName";
type OrderErrors = Partial<Record<OrderFieldKey, string>> & {
  products?: Array<Partial<Record<keyof InstallationProduct, string>>>;
};
type StatusFilter = "All" | "Pending" | "Completed";

type DashboardSnapshot = {
  orders: InstallationOrder[];
  submissions: InstallationSubmission[];
};

type DashboardRow = {
  order: InstallationOrder;
  status: "Pending" | "Completed";
  submission: InstallationSubmission | null;
};

const emptyProduct: InstallationProduct = {
  productName: "",
  serialNumber: "",
};

const emptyOrder: InstallationOrder = {
  orderNumber: "",
  products: [{ ...emptyProduct }],
  installationAddress: "",
  installationDate: "",
  technicianName: "",
};

const emptySnapshot = JSON.stringify({ orders: [], submissions: [] });

const orderFields: Array<{
  key: OrderFieldKey;
  label: string;
  type?: string;
}> = [
  { key: "orderNumber", label: "Order Number" },
  { key: "installationAddress", label: "Installation Address" },
  { key: "installationDate", label: "Installation Date", type: "date" },
  { key: "technicianName", label: "Technician Name" },
];

function getDashboardSnapshot() {
  return JSON.stringify({
    orders: getOrders(),
    submissions: getSubmissions(),
  });
}

function parseDashboardSnapshot(snapshot: string): DashboardSnapshot {
  try {
    const parsedSnapshot = JSON.parse(snapshot);

    return {
      orders: Array.isArray(parsedSnapshot.orders)
        ? parsedSnapshot.orders
        : [],
      submissions: Array.isArray(parsedSnapshot.submissions)
        ? parsedSnapshot.submissions
        : [],
    };
  } catch {
    return { orders: [], submissions: [] };
  }
}

function getConfirmationProducts(
  order: InstallationOrder,
  submission: InstallationSubmission | null,
) {
  return submission?.products.length ? submission.products : order.products;
}

function formatProducts(products: InstallationProduct[]) {
  if (products.length === 0) {
    return "-";
  }

  if (products.length === 1) {
    return `${products[0].productName} (${products[0].serialNumber})`;
  }

  return `${products.length} products`;
}

function escapePdfText(value: string) {
  return value
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(value: string, maxLength: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      return;
    }

    currentLine = nextLine;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : ["None"];
}

function bytesFromAscii(value: string) {
  return new TextEncoder().encode(value);
}

function bytesFromDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getSignatureImage(signatureImage?: string) {
  if (!signatureImage) {
    return null;
  }

  return new Promise<{
    bytes: Uint8Array;
    height: number;
    width: number;
  } | null>((resolve) => {
    const image = new window.Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 900;
      canvas.height = image.naturalHeight || 220;

      const context = canvas.getContext("2d");

      if (!context) {
        resolve(null);
        return;
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);

      resolve({
        bytes: bytesFromDataUrl(canvas.toDataURL("image/jpeg", 0.9)),
        height: canvas.height,
        width: canvas.width,
      });
    };

    image.onerror = () => resolve(null);
    image.src = signatureImage;
  });
}

function buildPdfBlob(
  contentStream: string,
  signatureImage: Awaited<ReturnType<typeof getSignatureImage>>,
) {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;

  function addBytes(bytes: Uint8Array) {
    chunks.push(bytes);
    offset += bytes.length;
  }

  function addAscii(value: string) {
    addBytes(bytesFromAscii(value));
  }

  function addObject(id: number, parts: Array<string | Uint8Array>) {
    offsets[id] = offset;
    addAscii(`${id} 0 obj\n`);

    parts.forEach((part) => {
      if (typeof part === "string") {
        addAscii(part);
      } else {
        addBytes(part);
      }
    });

    addAscii("\nendobj\n");
  }

  const contentBytes = bytesFromAscii(contentStream);
  const maxObjectId = signatureImage ? 6 : 5;
  const xObjectResource = signatureImage ? " /XObject << /Im1 6 0 R >>" : "";

  addAscii("%PDF-1.4\n");
  addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  addObject(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  addObject(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >>${xObjectResource} >> /Contents 5 0 R >>`,
  ]);
  addObject(4, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
  addObject(5, [
    `<< /Length ${contentBytes.length} >>\nstream\n`,
    contentBytes,
    "\nendstream",
  ]);

  if (signatureImage) {
    addObject(6, [
      `<< /Type /XObject /Subtype /Image /Width ${signatureImage.width} /Height ${signatureImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${signatureImage.bytes.length} >>\nstream\n`,
      signatureImage.bytes,
      "\nendstream",
    ]);
  }

  const xrefOffset = offset;
  addAscii(`xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`);

  for (let id = 1; id <= maxObjectId; id += 1) {
    addAscii(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }

  addAscii(
    `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  const pdfBuffer = new ArrayBuffer(offset);
  const pdfBytes = new Uint8Array(pdfBuffer);
  let position = 0;

  chunks.forEach((chunk) => {
    pdfBytes.set(chunk, position);
    position += chunk.length;
  });

  return new Blob([pdfBuffer], { type: "application/pdf" });
}

async function downloadConfirmationPdf(
  order: InstallationOrder,
  submission: InstallationSubmission | null,
) {
  const signatureImage = await getSignatureImage(submission?.signatureImage);
  const products = getConfirmationProducts(order, submission);
  const content: string[] = [];
  let y = 800;

  function addText(text: string, size = 11, x = 50) {
    content.push(`BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
    y -= size + 8;
  }

  addText("Installation Confirmation", 20);
  addText(`Order Number: ${order.orderNumber}`, 12);
  y -= 8;

  addText("Order Details", 15);
  addText(`Installation Address: ${order.installationAddress}`);
  addText(`Installation Date: ${order.installationDate}`);
  addText(`Technician Name: ${order.technicianName}`);
  y -= 8;

  addText("Products", 15);
  products.forEach((product, index) => {
    addText(
      `${index + 1}. ${product.productName} - Serial: ${product.serialNumber}`,
    );
  });
  y -= 8;

  addText("Customer Details", 15);
  addText(`Customer Name: ${submission?.customerName ?? "Pending"}`);
  addText(`Phone Number: ${submission?.phoneNumber ?? "Pending"}`);
  addText(`Service Rating: ${submission?.rating ?? "Pending"}`);
  addText(`Submitted Date: ${submission?.submittedAt ?? "Pending"}`);
  y -= 8;

  addText("Customer Comment", 15);
  wrapText(submission?.serviceComment || "No comment provided.", 78).forEach(
    (line) => addText(line),
  );
  y -= 8;

  addText("Customer Signature", 15);

  if (signatureImage) {
    const imageWidth = 250;
    const imageHeight = Math.min(
      100,
      (signatureImage.height / signatureImage.width) * imageWidth,
    );
    y -= imageHeight;
    content.push(`q ${imageWidth} 0 0 ${imageHeight} 50 ${y} cm /Im1 Do Q`);
  } else {
    addText("No signature available.");
  }

  const pdfBlob = buildPdfBlob(`${content.join("\n")}\n`, signatureImage);
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement("a");
  link.href = pdfUrl;
  link.download = `${order.orderNumber}-installation-confirmation.pdf`;
  link.click();
  URL.revokeObjectURL(pdfUrl);
}

export default function AdminPage() {
  const snapshot = useSyncExternalStore(
    subscribeToInstallationStorage,
    getDashboardSnapshot,
    () => emptySnapshot,
  );
  const { orders, submissions } = useMemo(
    () => parseDashboardSnapshot(snapshot),
    [snapshot],
  );
  const [order, setOrder] = useState<InstallationOrder>(emptyOrder);
  const [errors, setErrors] = useState<OrderErrors>({});
  const [customerLink, setCustomerLink] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [selectedRow, setSelectedRow] = useState<DashboardRow | null>(null);

  const rows = useMemo(() => {
    return orders.map((savedOrder) => {
      const submission =
        submissions.find(
          (savedSubmission) =>
            savedSubmission.installationId === savedOrder.orderNumber,
        ) ?? null;

      return {
        order: savedOrder,
        status: submission ? "Completed" : "Pending",
        submission,
      } satisfies DashboardRow;
    });
  }, [orders, submissions]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !normalizedSearch ||
        row.order.orderNumber.toLowerCase().includes(normalizedSearch) ||
        row.submission?.customerName
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "All" || row.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [rows, searchQuery, statusFilter]);

  const filteredSubmissions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return submissions.filter((submission) => {
      return (
        !normalizedSearch ||
        submission.installationId.toLowerCase().includes(normalizedSearch) ||
        submission.customerName.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [submissions, searchQuery]);

  const completedCount = rows.filter((row) => row.status === "Completed").length;
  const pendingCount = rows.filter((row) => row.status === "Pending").length;

  function validateOrder() {
    const nextErrors: OrderErrors = {};
    const productErrors = order.products.map((product) => {
      const nextProductErrors: Partial<
        Record<keyof InstallationProduct, string>
      > = {};

      if (!product.productName.trim()) {
        nextProductErrors.productName = "Product Name is required.";
      }

      if (!product.serialNumber.trim()) {
        nextProductErrors.serialNumber = "Serial Number is required.";
      }

      return nextProductErrors;
    });

    orderFields.forEach(({ key, label }) => {
      if (!order[key].trim()) {
        nextErrors[key] = `${label} is required.`;
      }
    });

    if (
      order.products.length === 0 ||
      productErrors.some((productError) => Object.keys(productError).length > 0)
    ) {
      nextErrors.products = productErrors;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validateOrder()) {
      setCustomerLink("");
      return;
    }

    const trimmedOrder: InstallationOrder = {
      orderNumber: order.orderNumber.trim(),
      products: order.products.map((product) => ({
        productName: product.productName.trim(),
        serialNumber: product.serialNumber.trim(),
      })),
      installationAddress: order.installationAddress.trim(),
      installationDate: order.installationDate.trim(),
      technicianName: order.technicianName.trim(),
    };

    saveOrder(trimmedOrder);
    setOrder(trimmedOrder);
    setCustomerLink(`/install/${encodeURIComponent(trimmedOrder.orderNumber)}`);
  }

  function updateProduct(
    index: number,
    key: keyof InstallationProduct,
    value: string,
  ) {
    setOrder((current) => ({
      ...current,
      products: current.products.map((product, productIndex) =>
        productIndex === index ? { ...product, [key]: value } : product,
      ),
    }));
    setErrors((current) => ({
      ...current,
      products: current.products?.map((productError, productIndex) =>
        productIndex === index
          ? { ...productError, [key]: undefined }
          : productError,
      ),
    }));
    setCustomerLink("");
  }

  function addProduct() {
    setOrder((current) => ({
      ...current,
      products: [...current.products, { ...emptyProduct }],
    }));
    setCustomerLink("");
  }

  function removeProduct(index: number) {
    setOrder((current) => ({
      ...current,
      products:
        current.products.length > 1
          ? current.products.filter((_, productIndex) => productIndex !== index)
          : current.products,
    }));
    setErrors((current) => ({
      ...current,
      products: current.products?.filter(
        (_, productIndex) => productIndex !== index,
      ),
    }));
    setCustomerLink("");
  }

  function getOrderForSubmission(submission: InstallationSubmission) {
    return (
      orders.find(
        (savedOrder) => savedOrder.orderNumber === submission.installationId,
      ) ?? {
        ...emptyOrder,
        orderNumber: submission.installationId,
        products: submission.products.length
          ? submission.products
          : [{ ...emptyProduct }],
      }
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
            Admin
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
            Installation Dashboard
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">
            Create installation orders and review locally saved customer
            confirmations.
          </p>
        </header>

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">Total Orders</p>
            <p className="mt-2 text-3xl font-semibold">{orders.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">Completed</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-700">
              {completedCount}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-zinc-500">Pending</p>
            <p className="mt-2 text-3xl font-semibold text-amber-700">
              {pendingCount}
            </p>
          </div>
        </section>

        <form
          className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm"
          onSubmit={handleSubmit}
          noValidate
        >
          <h2 className="text-lg font-semibold text-zinc-950">
            Create Installation Order
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {orderFields.map(({ key, label, type = "text" }) => (
              <div key={key}>
                <label
                  className="block text-sm font-medium text-zinc-700"
                  htmlFor={key}
                >
                  {label}
                </label>
                <input
                  className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                  id={key}
                  name={key}
                  onChange={(event) => {
                    setOrder((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }));
                    setErrors((current) => ({ ...current, [key]: undefined }));
                    setCustomerLink("");
                  }}
                  type={type}
                  value={order[key]}
                />
                {errors[key] ? (
                  <p className="mt-2 text-sm text-red-600">{errors[key]}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-zinc-950">
                Products
              </h3>
              <button
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                onClick={addProduct}
                type="button"
              >
                Add Product
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              {order.products.map((product, index) => (
                <div
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-[1fr_1fr_auto]"
                  key={index}
                >
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">
                      Product Name
                    </label>
                    <input
                      className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                      onChange={(event) =>
                        updateProduct(index, "productName", event.target.value)
                      }
                      value={product.productName}
                    />
                    {errors.products?.[index]?.productName ? (
                      <p className="mt-2 text-sm text-red-600">
                        {errors.products[index]?.productName}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700">
                      Serial Number
                    </label>
                    <input
                      className="mt-2 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                      onChange={(event) =>
                        updateProduct(index, "serialNumber", event.target.value)
                      }
                      value={product.serialNumber}
                    />
                    {errors.products?.[index]?.serialNumber ? (
                      <p className="mt-2 text-sm text-red-600">
                        {errors.products[index]?.serialNumber}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-end">
                    <button
                      className="h-10 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={order.products.length === 1}
                      onClick={() => removeProduct(index)}
                      type="button"
                    >
                      Remove Product
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-5 text-base font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 sm:w-auto"
            type="submit"
          >
            Save Order
          </button>
        </form>

        {customerLink ? (
          <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-sm">
            <h2 className="text-lg font-semibold">Customer Link</h2>
            <a
              className="mt-2 inline-block break-all text-base font-medium underline"
              href={customerLink}
            >
              {customerLink}
            </a>
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">
                Installation Orders
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Search and filter order status from localStorage.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search order or customer"
                type="search"
                value={searchQuery}
              />
              <div className="flex rounded-md border border-zinc-300 bg-white p-1">
                {(["All", "Pending", "Completed"] as const).map((filter) => (
                  <button
                    className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                      statusFilter === filter
                        ? "bg-zinc-950 text-white"
                        : "text-zinc-600 hover:bg-zinc-100"
                    }`}
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    type="button"
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Order</th>
                  <th className="py-3 pr-4 font-medium">Products</th>
                  <th className="py-3 pr-4 font-medium">Customer</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Submitted</th>
                  <th className="py-3 pr-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredRows.map((row) => (
                  <tr key={row.order.orderNumber}>
                    <td className="py-3 pr-4 font-semibold text-zinc-950">
                      {row.order.orderNumber}
                    </td>
                    <td className="py-3 pr-4">
                      {formatProducts(row.order.products)}
                    </td>
                    <td className="py-3 pr-4">
                      {row.submission?.customerName ?? "-"}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.status === "Completed"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {row.submission?.submittedAt ?? "-"}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                          onClick={() => setSelectedRow(row)}
                          type="button"
                        >
                          View details
                        </button>
                        <button
                          className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
                          onClick={() =>
                            downloadConfirmationPdf(row.order, row.submission)
                          }
                          type="button"
                        >
                          Download PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 ? (
            <p className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              No installation orders found.
            </p>
          ) : null}
        </section>

        {selectedRow ? (
          <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">
                  Order Details
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {selectedRow.order.orderNumber}
                </p>
              </div>
              <button
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                onClick={() => setSelectedRow(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Product Name</th>
                    <th className="py-2 pr-4 font-medium">Serial Number</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {getConfirmationProducts(
                    selectedRow.order,
                    selectedRow.submission,
                  ).map((product, index) => (
                    <tr key={`${product.serialNumber}-${index}`}>
                      <td className="py-2 pr-4">{product.productName}</td>
                      <td className="py-2 pr-4">{product.serialNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Address", selectedRow.order.installationAddress],
                ["Date", selectedRow.order.installationDate],
                ["Technician", selectedRow.order.technicianName],
                ["Status", selectedRow.status],
                ["Customer", selectedRow.submission?.customerName ?? "-"],
                ["Phone", selectedRow.submission?.phoneNumber ?? "-"],
                ["Rating", String(selectedRow.submission?.rating ?? "-")],
                ["Submitted", selectedRow.submission?.submittedAt ?? "-"],
                [
                  "Comment",
                  selectedRow.submission?.serviceComment ||
                    "No comment provided.",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm font-medium text-zinc-500">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-base text-zinc-950">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {selectedRow.submission?.signatureImage ? (
              <div className="mt-5">
                <p className="text-sm font-medium text-zinc-500">Signature</p>
                <img
                  alt="Customer signature preview"
                  className="mt-2 h-24 rounded-md border border-zinc-200 bg-zinc-50 object-contain p-2"
                  src={selectedRow.submission.signatureImage}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">
            Submitted Customer Confirmations
          </h2>
          <div className="mt-5 grid gap-4">
            {filteredSubmissions.map((submission) => {
              const matchingOrder = getOrderForSubmission(submission);
              const products = getConfirmationProducts(
                matchingOrder,
                submission,
              );

              return (
                <article
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                  key={submission.installationId}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Order Number
                        </p>
                        <p className="mt-1 font-semibold">
                          {submission.installationId}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Customer
                        </p>
                        <p className="mt-1 font-semibold">
                          {submission.customerName}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Phone
                        </p>
                        <p className="mt-1">{submission.phoneNumber}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Products
                        </p>
                        <p className="mt-1">{formatProducts(products)}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Rating
                        </p>
                        <p className="mt-1">{submission.rating}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-500">
                          Submitted
                        </p>
                        <p className="mt-1">{submission.submittedAt}</p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-3">
                        <p className="text-sm font-medium text-zinc-500">
                          Comment
                        </p>
                        <p className="mt-1 whitespace-pre-wrap">
                          {submission.serviceComment || "No comment provided."}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <img
                        alt="Customer signature preview"
                        className="h-24 w-48 rounded-md border border-zinc-200 bg-white object-contain p-2"
                        src={submission.signatureImage}
                      />
                      <div className="flex gap-2">
                        <button
                          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-white"
                          onClick={() =>
                            setSelectedRow({
                              order: matchingOrder,
                              status: "Completed",
                              submission,
                            })
                          }
                          type="button"
                        >
                          View details
                        </button>
                        <button
                          className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
                          onClick={() =>
                            downloadConfirmationPdf(matchingOrder, submission)
                          }
                          type="button"
                        >
                          Download PDF
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {filteredSubmissions.length === 0 ? (
            <p className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              No customer confirmations found.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
