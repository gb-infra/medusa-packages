import { model } from "@medusajs/framework/utils"
import Transformation from "./transformation";

const EventWebhook = model
  .define("event_webhook", {
    id: model.id({ prefix: "ewb" }).primaryKey(),
    method: model.text().default("post"),
    webhook_url: model.text(),
    event_type: model.text().nullable(),
    default_headers: model.json().nullable(),
    transformation_id: model.id().nullable(),
    active: model.boolean().default(true),
    access_key: model.text(),
    pre_callback: model.text(),
    created_at: model.dateTime().default(new Date()),
    updated_at: model.dateTime().default(new Date()),

    // Define relations
    transformation: model.belongsTo(() => Transformation, {
      foreignKey: "transformation_id",
      nullable: true,
    }),
  })
  .indexes([
    {
      on: ["webhook_url"],
      unique: true,
    },
    {
      on: ["access_key"],
      unique: true,
    },
  ]);

  export default EventWebhook;