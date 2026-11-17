import {createHash} from 'node:crypto';

export const CONTEXT_REMINDER_STATUS='Context Manager: context reminder';
export const reminderDigest=text=>createHash('sha256').update(text.trim()).digest('hex');
