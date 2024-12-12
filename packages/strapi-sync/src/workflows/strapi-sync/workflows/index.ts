import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { createProductStep } from "../steps";
import { AuthInterface } from "@types";

export const createProductWorkflow = createWorkflow(
  "create-product",
  function (input: {data: any, authInterface: AuthInterface}) {
    return new WorkflowResponse(createProductStep(input));
  }
);
