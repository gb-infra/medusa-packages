import { model } from "@medusajs/framework/utils";

const Transformation = model
  .define("transformation", {
    id: model.id({ prefix: "trf" }).primaryKey(),
    serialization_ogic: model.text(),
    event_name: model.text(),
    post_callback: model.text(),
    assign_action: model.text(),
    created_at: model.dateTime().default(new Date()),
    updated_at: model.dateTime().default(new Date()),
    created_by: model.text(),
    updated_by: model.text(),
  })
  .indexes([{ on: ["event_name"] }]);

export default Transformation;
