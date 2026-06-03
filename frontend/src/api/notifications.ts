import { api } from "./client";

export interface Notification {
  id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  channel: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export const listNotifications = (unread = false) =>
  api<Notification[]>(`/notifications${unread ? "?unread=true" : ""}`);

export const markRead = (id: string) =>
  api<Notification>(`/notifications/${id}/read`, { method: "POST" });

export const markAllRead = () => api<void>("/notifications/read-all", { method: "POST" });
