export * as SessionSchema from "./schema"

import { Session } from "@opencode-ai/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

/** Matches the default title format assigned at session creation in V2 (packages/core/src/session.ts:228). */
export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}
