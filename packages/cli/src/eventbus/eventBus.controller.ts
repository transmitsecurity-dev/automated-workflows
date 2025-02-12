import express from 'express';
import { isEventMessageOptions } from './EventMessageClasses/AbstractEventMessage';
import { EventMessageGeneric } from './EventMessageClasses/EventMessageGeneric';
import type { EventMessageWorkflowOptions } from './EventMessageClasses/EventMessageWorkflow';
import { EventMessageWorkflow } from './EventMessageClasses/EventMessageWorkflow';
import type { EventMessageReturnMode } from './MessageEventBus/MessageEventBus';
import { eventBus } from './MessageEventBus/MessageEventBus';
import type { EventMessageTypes, FailedEventSummary } from './EventMessageClasses';
import { eventNamesAll } from './EventMessageClasses';
import type { EventMessageAuditOptions } from './EventMessageClasses/EventMessageAudit';
import { EventMessageAudit } from './EventMessageClasses/EventMessageAudit';
import type { IRunExecutionData } from 'n8n-workflow';
import { EventMessageTypeNames } from 'n8n-workflow';
import type { EventMessageNodeOptions } from './EventMessageClasses/EventMessageNode';
import { EventMessageNode } from './EventMessageClasses/EventMessageNode';
import { recoverExecutionDataFromEventLogMessages } from './MessageEventBus/recoverEvents';
import { RestController, Get, Post, Authorized, RequireGlobalScope } from '@/decorators';
import { BadRequestError } from '@/errors/response-errors/bad-request.error';

// ----------------------------------------
// TypeGuards
// ----------------------------------------

const isWithQueryString = (candidate: unknown): candidate is { query: string } => {
	const o = candidate as { query: string };
	if (!o) return false;
	return o.query !== undefined;
};

// ----------------------------------------
// Controller
// ----------------------------------------

@Authorized()
@RestController('/eventbus')
export class EventBusController {
	// ----------------------------------------
	// Events
	// ----------------------------------------
	@Get('/event')
	@RequireGlobalScope('eventBusEvent:query')
	async getEvents(
		req: express.Request,
	): Promise<EventMessageTypes[] | Record<string, EventMessageTypes[]>> {
		if (isWithQueryString(req.query)) {
			switch (req.query.query as EventMessageReturnMode) {
				case 'sent':
					return await eventBus.getEventsSent();
				case 'unsent':
					return await eventBus.getEventsUnsent();
				case 'unfinished':
					return await eventBus.getUnfinishedExecutions();
				case 'all':
				default:
					return await eventBus.getEventsAll();
			}
		} else {
			return await eventBus.getEventsAll();
		}
	}

	@Get('/failed')
	@RequireGlobalScope('eventBusEvent:list')
	async getFailedEvents(req: express.Request): Promise<FailedEventSummary[]> {
		const amount = parseInt(req.query?.amount as string) ?? 5;
		return await eventBus.getEventsFailed(amount);
	}

	@Get('/execution/:id')
	@RequireGlobalScope('eventBusEvent:read')
	async getEventForExecutionId(req: express.Request): Promise<EventMessageTypes[] | undefined> {
		if (req.params?.id) {
			let logHistory;
			if (req.query?.logHistory) {
				logHistory = parseInt(req.query.logHistory as string, 10);
			}
			return await eventBus.getEventsByExecutionId(req.params.id, logHistory);
		}
		return;
	}

	@Get('/execution-recover/:id')
	@RequireGlobalScope('eventBusEvent:read')
	async getRecoveryForExecutionId(req: express.Request): Promise<IRunExecutionData | undefined> {
		const { id } = req.params;
		if (req.params?.id) {
			const logHistory = parseInt(req.query.logHistory as string, 10) || undefined;
			const applyToDb = req.query.applyToDb !== undefined ? !!req.query.applyToDb : true;
			const messages = await eventBus.getEventsByExecutionId(id, logHistory);
			if (messages.length > 0) {
				return await recoverExecutionDataFromEventLogMessages(id, messages, applyToDb);
			}
		}
		return;
	}

	@Post('/event')
	@RequireGlobalScope('eventBusEvent:create')
	async postEvent(req: express.Request): Promise<EventMessageTypes | undefined> {
		let msg: EventMessageTypes | undefined;
		if (isEventMessageOptions(req.body)) {
			switch (req.body.__type) {
				case EventMessageTypeNames.workflow:
					msg = new EventMessageWorkflow(req.body as EventMessageWorkflowOptions);
					break;
				case EventMessageTypeNames.audit:
					msg = new EventMessageAudit(req.body as EventMessageAuditOptions);
					break;
				case EventMessageTypeNames.node:
					msg = new EventMessageNode(req.body as EventMessageNodeOptions);
					break;
				case EventMessageTypeNames.generic:
				default:
					msg = new EventMessageGeneric(req.body);
			}
			await eventBus.send(msg);
		} else {
			throw new BadRequestError(
				'Body is not a serialized EventMessage or eventName does not match format {namespace}.{domain}.{event}',
			);
		}
		return msg;
	}

	// ----------------------------------------
	// Utilities
	// ----------------------------------------

	@Get('/eventnames')
	async getEventNames(): Promise<string[]> {
		return eventNamesAll;
	}
}
