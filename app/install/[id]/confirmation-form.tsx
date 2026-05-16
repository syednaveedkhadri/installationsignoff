"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, PointerEvent } from "react";
import {
  getOrderByNumber,
  saveSubmission as saveInstallationSubmission,
} from "../../lib/installations";
import type { InstallationSubmission } from "../../lib/installations";

export { getSubmissions, saveSubmission } from "../../lib/installations";

type FormErrors = {
  form?: string;
  customerName?: string;
  phoneNumber?: string;
  signature?: string;
  rating?: string;
};

function subscribeToHydrationChange() {
  return () => undefined;
}

export function ConfirmationForm({ installationId }: { installationId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const isOrderLoaded = useSyncExternalStore(
    subscribeToHydrationChange,
    () => true,
    () => false,
  );
  const order = isOrderLoaded ? getOrderByNumber(installationId) : null;
  const [customerName, setCustomerName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [serviceComment, setServiceComment] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [savedSubmission, setSavedSubmission] =
    useState<InstallationSubmission | null>(null);

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function beginSignature(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = getCanvasPoint(event);
    isDrawingRef.current = true;
    context.fillStyle = "#111827";
    context.beginPath();
    context.arc(x, y, 2, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(x, y);
    setHasSignature(true);
    setErrors((current) => ({
      ...current,
      form: undefined,
      signature: undefined,
    }));
    setSubmitted(false);
  }

  function drawSignature(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!context) {
      return;
    }

    const { x, y } = getCanvasPoint(event);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#111827";
    context.lineTo(x, y);
    context.stroke();
  }

  function endSignature() {
    isDrawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    setHasSignature(false);
    setErrors((current) => ({ ...current, form: undefined }));
    setSubmitted(false);
    setSavedSubmission(null);
  }

  function validateForm() {
    const nextErrors: FormErrors = {};

    if (!customerName.trim()) {
      nextErrors.customerName = "Customer name is required.";
    }

    if (!phoneNumber.trim()) {
      nextErrors.phoneNumber = "Phone number is required.";
    }

    if (!hasSignature) {
      nextErrors.signature = "Signature is required.";
    }

    if (rating === null) {
      nextErrors.rating = "Service rating is required.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validateForm()) {
      setSubmitted(false);
      return;
    }

    const canvas = canvasRef.current;
    const currentOrder = order;
    const selectedRating = rating;

    if (!currentOrder) {
      setErrors({ form: "Installation order not found." });
      setSubmitted(false);
      return;
    }

    if (!canvas) {
      setErrors({ signature: "Signature is required." });
      setSubmitted(false);
      return;
    }

    if (selectedRating === null) {
      setErrors({ rating: "Service rating is required." });
      setSubmitted(false);
      return;
    }

    try {
      const submission: InstallationSubmission = {
        installationId,
        customerName: customerName.trim(),
        phoneNumber: phoneNumber.trim(),
        rating: selectedRating,
        serviceComment: serviceComment.trim(),
        products: currentOrder.products,
        signatureImage: canvas.toDataURL("image/png"),
        submittedAt: new Date().toISOString(),
      };
      const wasSaved = saveInstallationSubmission(submission);

      if (!wasSaved) {
        setErrors({
          form: "This installation confirmation has already been submitted.",
        });
        setSubmitted(false);
        return;
      }

      setErrors({});
      setSubmitted(true);
      setSavedSubmission(submission);
    } catch {
      setErrors({
        form: "Unable to save submission locally. Please try again.",
      });
      setSubmitted(false);
    }
  }

  if (!isOrderLoaded) {
    return (
      <main className="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#f5f3ff_100%)] px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="rounded-lg border border-white/70 bg-white/90 p-5 text-slate-700 shadow-[0_18px_45px_rgba(30,64,175,0.08)] backdrop-blur">
            Loading installation order...
          </p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#f5f3ff_100%)] px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <p className="rounded-lg border border-white/70 bg-white/90 p-5 text-slate-700 shadow-[0_18px_45px_rgba(30,64,175,0.08)] backdrop-blur">
            Installation order not found.
          </p>
        </div>
      </main>
    );
  }

  const installationDetails = [
    ["Order Number", order.orderNumber],
    ["Installation Address", order.installationAddress],
    ["Installation Date", order.installationDate],
    ["Technician Name", order.technicianName],
  ] as const;

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#f5f3ff_100%)] px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-8 overflow-hidden rounded-lg border border-white/70 bg-white/85 p-6 shadow-[0_22px_70px_rgba(30,64,175,0.10)] backdrop-blur sm:p-8">
          <p className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            Installation ID {installationId}
          </p>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Customer Installation Confirmation
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Review the installation details and complete the customer handover
            confirmation.
          </p>
        </header>

        {savedSubmission ? (
          <section className="mb-6 rounded-lg border border-white/70 bg-white/90 p-5 shadow-[0_18px_45px_rgba(30,64,175,0.08)] backdrop-blur sm:p-6">
            <h2 className="text-lg font-semibold text-slate-950">
              Saved Submission Data
            </h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-slate-500">
                  Installation ID
                </dt>
                <dd className="mt-1 text-base font-semibold text-slate-950">
                  {savedSubmission.installationId}
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-slate-500">Rating</dt>
                <dd className="mt-1 text-base font-semibold text-slate-950">
                  {savedSubmission.rating}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-slate-500">
                  Service Comment
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-base text-slate-950">
                  {savedSubmission.serviceComment || "No comment provided."}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-slate-500">
                  Products
                </dt>
                <dd className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-4 font-medium">
                          Product Name
                        </th>
                        <th className="py-2 pr-4 font-medium">
                          Serial Number
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {savedSubmission.products.map((product, index) => (
                        <tr key={`${product.serialNumber}-${index}`}>
                          <td className="py-2 pr-4 text-slate-950">
                            {product.productName}
                          </td>
                          <td className="py-2 pr-4 text-slate-950">
                            {product.serialNumber}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="mb-6 rounded-lg border border-white/70 bg-white/90 p-5 shadow-[0_18px_45px_rgba(30,64,175,0.08)] backdrop-blur sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">
            Installation Details
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {installationDetails.map(([label, value]) => (
              <div
                className="rounded-lg border border-slate-100 bg-slate-50/70 p-4"
                key={label}
              >
                <dt className="text-sm font-medium text-slate-500">{label}</dt>
                <dd className="mt-1 text-base font-semibold text-slate-950">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Product Name</th>
                  <th className="py-3 pr-4 font-medium">Serial Number</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {order.products.map((product, index) => (
                  <tr key={`${product.serialNumber}-${index}`}>
                    <td className="py-3 pr-4 font-semibold text-slate-950">
                      {product.productName}
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {product.serialNumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-6 rounded-lg border border-blue-100 bg-blue-50/80 p-5 shadow-[0_18px_45px_rgba(30,64,175,0.07)] sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">
            Completion Note
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-700">
            The products listed above have been delivered, installed, tested, and
            confirmed to be working properly in good condition at the time of
            handover.
          </p>
        </section>

        <form
          className="rounded-lg border border-white/70 bg-white/95 p-5 shadow-[0_22px_70px_rgba(30,64,175,0.10)] backdrop-blur sm:p-6"
          onSubmit={handleSubmit}
          noValidate
        >
          <h2 className="text-lg font-semibold text-slate-950">
            Customer Confirmation
          </h2>
          {errors.form ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {errors.form}
            </p>
          ) : null}

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-slate-700"
                htmlFor="customerName"
              >
                Customer Name
              </label>
              <input
                className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                id="customerName"
                name="customerName"
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setErrors((current) => ({
                    ...current,
                    form: undefined,
                    customerName: undefined,
                  }));
                  setSubmitted(false);
                  setSavedSubmission(null);
                }}
                type="text"
                value={customerName}
              />
              {errors.customerName ? (
                <p className="mt-2 text-sm text-red-600">
                  {errors.customerName}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="block text-sm font-medium text-slate-700"
                htmlFor="phoneNumber"
              >
                Phone Number
              </label>
              <input
                className="mt-2 block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                id="phoneNumber"
                inputMode="tel"
                name="phoneNumber"
                onChange={(event) => {
                  setPhoneNumber(event.target.value);
                  setErrors((current) => ({
                    ...current,
                    form: undefined,
                    phoneNumber: undefined,
                  }));
                  setSubmitted(false);
                  setSavedSubmission(null);
                }}
                type="tel"
                value={phoneNumber}
              />
              {errors.phoneNumber ? (
                <p className="mt-2 text-sm text-red-600">
                  {errors.phoneNumber}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label
                className="block text-sm font-medium text-slate-700"
                htmlFor="signature"
              >
                Digital Signature
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                onClick={clearSignature}
                type="button"
              >
                Clear Signature
              </button>
            </div>
            <canvas
              aria-label="Digital signature box"
              className="mt-2 block h-44 w-full touch-none rounded-md border border-slate-200 bg-slate-50 shadow-inner"
              height={220}
              id="signature"
              onPointerCancel={endSignature}
              onPointerDown={beginSignature}
              onPointerLeave={endSignature}
              onPointerMove={drawSignature}
              onPointerUp={endSignature}
              ref={canvasRef}
              width={900}
            />
            {errors.signature ? (
              <p className="mt-2 text-sm text-red-600">{errors.signature}</p>
            ) : null}
          </div>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-slate-700">
              Service Rating
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  aria-label={`${value} star rating`}
                  aria-pressed={rating === value}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-md border text-2xl leading-none shadow-sm transition focus:outline-none focus:ring-4 focus:ring-violet-500/15 ${
                    rating !== null && value <= rating
                      ? "border-violet-300 bg-violet-50 text-violet-600"
                      : "border-slate-200 bg-white text-slate-300 hover:border-violet-200 hover:text-violet-400"
                  }`}
                  key={value}
                  onClick={() => {
                    setRating(value);
                    setErrors((current) => ({
                      ...current,
                      form: undefined,
                      rating: undefined,
                    }));
                    setSubmitted(false);
                    setSavedSubmission(null);
                  }}
                  type="button"
                >
                  ★
                </button>
              ))}
            </div>
            {errors.rating ? (
              <p className="mt-2 text-sm text-red-600">{errors.rating}</p>
            ) : null}
          </fieldset>

          <div className="mt-5">
            <label
              className="block text-sm font-medium text-slate-700"
              htmlFor="serviceComment"
            >
              Service Comment
            </label>
            <textarea
              className="mt-2 block min-h-28 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10"
              id="serviceComment"
              name="serviceComment"
              onChange={(event) => {
                setServiceComment(event.target.value);
                setErrors((current) => ({ ...current, form: undefined }));
                setSubmitted(false);
                setSavedSubmission(null);
              }}
              placeholder="Write your comment about the service"
              value={serviceComment}
            />
          </div>

          <button
            className={`mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-md px-5 py-2 text-base font-semibold text-white transition focus:outline-none focus:ring-4 sm:w-auto ${
              submitted
                ? "cursor-not-allowed bg-emerald-600 shadow-[0_14px_30px_rgba(16,185,129,0.24)] focus:ring-emerald-500/20"
                : "bg-gradient-to-r from-blue-600 to-violet-600 shadow-[0_14px_30px_rgba(79,70,229,0.24)] hover:from-blue-700 hover:to-violet-700 focus:ring-blue-500/20"
            }`}
            disabled={submitted}
            type="submit"
          >
            {submitted
              ? "Installation Confirmation Submitted Successfully"
              : "Submit"}
          </button>
        </form>
      </div>
    </main>
  );
}
