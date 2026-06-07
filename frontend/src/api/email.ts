import { api } from "./client";

export interface EmailMessage {
  id: string;
  to_email: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
}

export const listOutbox = (status?: string) =>
  api<EmailMessage[]>(`/email/outbox${status ? `?status_filter=${status}` : ""}`);

export const dispatchEmails = () =>
  api<{ dispatched: number }>("/email/dispatch", { method: "POST" });
