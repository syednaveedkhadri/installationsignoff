import type { Metadata } from "next";
import { ConfirmationForm } from "./confirmation-form";

export const metadata: Metadata = {
  title: "Installation Confirmation",
  description: "Customer installation confirmation form",
};

export default async function InstallationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ConfirmationForm installationId={id} />;
}
