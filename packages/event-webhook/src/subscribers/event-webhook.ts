import axios from "axios";
import retry from "async-retry";
import dotenv from "dotenv";
import * as handlebars from "handlebars";
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  EventWebhookModuleService,
  TransformationModuleService,
} from "@services";

dotenv.config();

const totalTimeout = 3600000;
const sendWebhook = (
  arg: { webhook: EventWebhooks; parsedData: any },
  maxRetryCount: number
) => {
  const { webhook, parsedData } = arg;
  return retry(
    async () => {
      const baseUrl = handlebars.compile(webhook.webhook_url)(parsedData);
      return axios[webhook.method](baseUrl, JSON.stringify(parsedData), {
        headers: {
          "Content-Type": "application/json",
          "X-ACCESS_KEY": webhook.access_key,
          ...webhook.default_headers,
        },
      }).catch((e) => {
        throw new Error(e.message);
      });
    },
    {
      retries: maxRetryCount,
      randomize: true,
      maxRetryTime: totalTimeout,
      onRetry: (e, attempt) => {},
    }
  );
};

export async function processInBatches<T>(
  tasks: (() => Promise<T>)[],
  batchSize: number = tasks.length
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map((task) => task());
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }
  return results;
}

export default async function eventsWebhookHandler({
  event,
  container,
  pluginOptions,
}: SubscriberArgs<any>) {
  try {
    const eventsDataService: EventsDataService =
      container.resolve("eventsDataService");
    const eventWebhookService: EventWebhookModuleService = container.resolve(
      "eventWebhookModuleService"
    );
    const transformationService: TransformationModuleService =
      container.resolve("transformationModuleService");
    const preCallbackService = container.resolve("preCallbackService");
    const postCallbackService = container.resolve("postCallbackService");

    const webhooks = await eventWebhookService.getFilteredWebhooks({
      where: { active: true, event_type: event.name },
      relations: ["transformation"],
    });
    if (!webhooks.length)
      return {
        status: 200,
        message: `No active webhook found for eventName: ${event.name}`,
      };

    const maxTry = Number(pluginOptions.MAX_RETRY_COUNT || 10);
    let parsedData = await eventsDataService.fetchData(event.name, event.data);

    const preCallbackMap = new Map();
    const preCallbackTasks = [
      ...webhooks
        .filter(
          (web) => web.pre_callback && preCallbackService[web.pre_callback]
        )
        .map((web) => web.pre_callback),
    ].map((callback) => async () => {
      const res = await preCallbackService[callback](parsedData);
      if (res.statusCode === 201) preCallbackMap.set(callback, res.data);
    });

    if (preCallbackTasks.length) await processInBatches(preCallbackTasks);

    const { transformWebhooks, normalWebhooks } = webhooks.reduce<{
      transformWebhooks: EventWebhooks[];
      normalWebhooks: EventWebhooks[];
    }>(
      (acc, webhook) => {
        if (webhook.transformation_id) acc.transformWebhooks.push(webhook);
        else acc.normalWebhooks.push(webhook);
        return acc;
      },
      { transformWebhooks: [], normalWebhooks: [] }
    );

    const resultData: { parsedData: any; webhook: EventWebhooks }[] =
      normalWebhooks.map((webhook) => {
        let transformData = Object.assign({}, parsedData);
        if (webhook.pre_callback && preCallbackMap.get(webhook.pre_callback))
          transformData = preCallbackMap.get(webhook.pre_callback);

        return { parsedData: transformData, webhook };
      });

    const transTasks = transformWebhooks.map((webhook) => async () => {
      try {
        const transformation = webhook.transformation;
        let transformData = Object.assign({}, parsedData);
        if (webhook.pre_callback && preCallbackMap.get(webhook.pre_callback))
          transformData = preCallbackMap.get(webhook.pre_callback);

        transformData = await transformationService.executeTransformation(
          webhook.transformation,
          parsedData
        );

        if (
          transformation.postCallback &&
          postCallbackService[transformation.postCallback]
        )
          transformData = await postCallbackService[
            transformation.postCallback
          ](transformData);

        transformationService.postTransformAssignAction(
          resultData,
          { parsedData: transformData, webhook },
          webhook.transformation
        );
      } catch (error) {
        console.error(
          `ERROR:: while processing transform task in webhook ${webhook.webhook_url}`,
          error
        );
      }
    });

    if (transTasks.length) await processInBatches(transTasks);

    const webCallTasks = resultData.map((web) => async () => {
      try {
        await sendWebhook(web, maxTry);
      } catch (error) {
        console.error(
          `ERROR:: while calling the webhook url ${
            web.webhook.webhook_url
          } with data ${JSON.stringify(web.parsedData)}`,
          error
        );
      }
    });

    if (webCallTasks.length) await processInBatches(webCallTasks);
    return {
      status: 201,
      message: `Webhook processed for eventName: ${eventName} successfully!`,
    };
  } catch (error) {
    throw error;
  }
}

export const config: SubscriberConfig = {
  event: [...(process.env.MEDUSA_ADMIN_EVENTS?.split(",") || [])],
  context: {
    subscriberId: "event-webhooks",
  },
};
