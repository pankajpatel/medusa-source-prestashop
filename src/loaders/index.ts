import { BatchJobService } from "@medusajs/medusa";

export default async (container, options) => {
  try {
    const batchJobService: BatchJobService =
      container.resolve("batchJobService");
    console.log("Creating batch job to import prestashop products...");
    await batchJobService.create({
      type: "import-prestashop",
      context: { options },
      dry_run: false,
      created_by: "",
    });
  } catch (err) {
    console.log(err);
  }
};
