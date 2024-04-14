"use strict";
import * as fs from "fs";
import puppeteer, { ElementHandle, Page, TimeoutError } from "puppeteer";
import { cases } from "./testCases";
import {
  checkDownloadError,
  getPageContent,
  getTabbableElements,
  inArray,
  print,
  printCurrentCost,
  redactMessages,
  round,
  sleep,
  tokenCost,
  waitForNavigation,
} from "./utils";

const autopilot = true;
export const model = "gpt-3.5-turbo";
export const contextLengthLimit = 15000;
export const navigationTimeout = 10000;
export type Element = any;
let headless = false;
let taskPrefix = "<!_TASK_!>";
let tokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};
let downloadStarted = false;
let pageLoaded = false;
let requestCount = 0;
let requestBlock = false;
let responseCount = 0;
let thePage: Page | undefined;

print("Using model: " + model + "\n");

const openaiApiKey = "YOUR_API_KEY";

const sendChatMessage = async (
  message: any,
  testCase: any,
  context: any[],
  functionCall: any = "auto",
  functions: any = null
) => {
  let messages = [...context];
  messages.push(message);

  let definitions = [
    {
      name: "makePlan",
      description:
        "Create a plan to accomplish the given task. Summarize what the user's task is in a step by step manner. How would you browse the internet to accomplish the task. Start with 'I will'",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description:
              "The step by step plan on how you will navigate the internet and what you will do",
          },
        },
      },
      required: ["plan"],
    },
    {
      name: "readFile",
      description:
        "Read the contents of a file that the user has provided to you",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description:
              "The filename to read, e.g. file.txt or path/to/file.txt",
          },
        },
      },
      required: ["filename"],
    },
    {
      name: "gotoUrl",
      description: "Goes to a specific URL and gets the content",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to go to (including protocol)",
          },
        },
      },
      required: ["url"],
    },
    {
      name: "clickLink",
      description:
        "Clicks a link with the given pgpt_id on the page. Note that pgpt_id is required and you must use the corresponding pgpt-id attribute from the page content. Add the text of the link to confirm that you are clicking the right link.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text on the link you want to click",
          },
          pgpt_id: {
            type: "number",
            description:
              "The pgpt-id of the link to click (from the page content)",
          },
        },
      },
      required: ["reason", "pgpt_id"],
    },
    {
      name: "typeText",
      description: "Types text to input fields and optionally submit the form",
      parameters: {
        type: "object",
        properties: {
          form_data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pgpt_id: {
                  type: "number",
                  description:
                    "The pgpt-id attribute of the input to type into (from the page content)",
                },
                text: {
                  type: "string",
                  description: "The text to type",
                },
              },
            },
          },
          submit: {
            type: "boolean",
            description: "Whether to submit the form after filling the fields",
          },
        },
      },
      required: ["form_data", "submit"],
    },
    {
      name: "answerUser",
      description: `Give an answer to the user and end the navigation. Summarize all relevant info based on the intruction you vere given which is: ${testCase.intructions}. Then give an answer if the expected result which is: @{testCase.expectedResult} is true or false`,
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "A summary of the relevant parts of the page content that you base the answer on",
          },
          yourAnswer: {
            type: "string",
            description:
              "Reflect over your answer and describe why you answered the way you did and what the question was you need to answer which you question was",
          },
          answer: {
            type: "boolean",
            description: `Answer true or false based on wether the expected result which is: ${testCase.expectedResult} aligns with the information you gathered`,
          },
        },
      },
      required: ["summary", "answer", "yourAnswer"],
    },
  ];
  if (functions !== null) {
    definitions = definitions.filter((definition) => {
      return inArray(definition.name, functions);
    });
  }
  print(taskPrefix + "Sending ChatGPT request...");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: redactMessages(messages),
      functions: definitions,
      function_call: functionCall ?? "auto",
    }),
  }).catch(async function (e) {
    print(e);
    if (e.error.code == "rate_limit_exceeded") {
      await sleep(10000);
      return await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: redactMessages(messages),
          functions: definitions,
          function_call: functionCall ?? "auto",
        }),
      });
    }
  });
  const data = await response?.json();
  if (data.choices === undefined) {
    print(data);
  } else if (data.choices[0].message.hasOwnProperty("function_call")) {
    data.choices[0].message.function_call.arguments =
      data.choices[0].message.function_call.arguments.replace(
        '"\n "',
        '",\n "'
      );
  }
  tokenUsage.completionTokens += data.usage.completion_tokens;
  tokenUsage.promptTokens += data.usage.prompt_tokens;
  tokenUsage.totalTokens += data.usage.total_tokens;
  let cost = tokenCost(
    data.usage.prompt_tokens,
    data.usage.completion_tokens,
    model
  );
  if (cost > 0.09) {
    print(
      "Cost: +" +
        round(cost, 2) +
        " USD (+" +
        data.usage.total_tokens +
        " tokens)"
    );
  }
  if (autopilot) {
    print(
      "<!_TOKENS_!>" +
        data.usage.prompt_tokens +
        " " +
        data.usage.completion_tokens +
        " " +
        data.usage.total_tokens
    );
  }
  return data.choices[0].message;
};

const startBrowser = async (): Promise<Page> => {
  if (thePage) {
    return thePage;
  }
  const browser = await puppeteer.launch({
    headless: headless ? true : false,
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1200,
    height: 1200,
    deviceScaleFactor: 1,
  });
  page.on("request", (request) => {
    if (requestBlock) {
      if (request.isNavigationRequest()) {
        request.respond({
          status: 200,
          contentType: "application/octet-stream",
          body: "Dummy file to block navigation",
        });
      } else {
        request.continue();
      }
    }
    requestCount++;
  });
  page.on("load", () => {
    pageLoaded = true;
  });
  page.on("framenavigated", async (frame: {}) => {
    if (frame === page.mainFrame()) {
      pageLoaded = false;
    }
  });
  page.on("response", async (response) => {
    responseCount++;
    let headers = response.headers();
    if (
      headers["content-disposition"]?.includes("attachment") ||
      parseInt(headers["content-length"]) > 1024 * 1024 ||
      headers["content-type"] === "application/octet-stream"
    ) {
      setTimeout(() => {
        if (responseCount == 1) {
          print("DOWNLOAD: A file download has been detected");
          downloadStarted = true;
        }
      }, 2000);
    }
  });
  thePage = page;
  return thePage;
};
const doNextStep = async (
  page: Page,
  context: any[],
  nextStep: any,
  linksAndInputs: any[],
  element: ElementHandle | null
): Promise<void> => {
  let message: string = "";
  let msg: any;
  let noContent = false;

  if (nextStep.hasOwnProperty("function_call")) {
    const functionCall = nextStep.function_call;
    const functionName = functionCall.name;
    let funcArguments: any;

    try {
      funcArguments = JSON.parse(functionCall.arguments);
    } catch (e) {
      if (functionName === "answerUser") {
        console.log("answerUser", functionCall.arguments);
        funcArguments = {
          answer: functionCall.arguments,
        };
      }
    }

    if (functionName === "makePlan") {
      message = "OK. Please continue according to the plan";
    } else if (functionName === "read_file") {
      const filename = funcArguments.filename;
      if (autopilot) {
        print();
        print(taskPrefix + "Reading file " + filename);
        if (fs.existsSync(filename)) {
          let fileData = fs.readFileSync(filename, "utf-8");
          fileData = fileData.substring(0, contextLengthLimit);
          message = fileData;
        } else {
          message = "ERROR: That file does not exist";
        }
      } else {
        print();
        message = "ERROR: You are not allowed to read this file";
      }
    } else if (functionName === "gotoUrl") {
      const url = funcArguments.url;
      print(taskPrefix + "Going to " + url);
      try {
        await page.goto(url, {
          timeout: navigationTimeout,
        });
        const currentUrl = await page.url();
        message = `You are now on ${currentUrl}`;
      } catch (error) {
        message = checkDownloadError(error) || "";
        message = message ?? "There was an error going to the URL";
      }
      print(taskPrefix + "Scraping page...");
      linksAndInputs = await getTabbableElements(page);
    } else if (functionName === "clickLink") {
      const linkId = funcArguments.pgpt_id;
      const linkText = funcArguments.text;
      if (!linkId) {
        message = "ERROR: Missing parameter pgpt_id";
      } else if (!linkText) {
        message = "";
        context.pop();
        msg = {
          role: "user",
          content:
            "Please select the correct link on the page. Remember to set both the text and the pgpt_id parameter.",
        };
      } else {
        const link = linksAndInputs.find((elem) => elem && elem.id == linkId);
        try {
          print(taskPrefix + `Clicking link "${link.text}"`);
          requestCount = 0;
          responseCount = 0;
          downloadStarted = false;
          if (!(await page.$(".pgpt-element" + linkId))) {
            throw new Error("Element not found");
          }
          await page.click(".pgpt-element" + linkId);
          await waitForNavigation(page);
          const currentUrl = await page.url();
          if (downloadStarted) {
            downloadStarted = false;
            message = "Link clicked and file download started successfully!";
            noContent = true;
          } else {
            message = "Link clicked! You are now on " + currentUrl;
          }
        } catch (error) {
          if (error instanceof TimeoutError) {
            message = "NOTICE: The click did not cause a navigation.";
          } else {
            const linkText = link ? link.text : "";
            message = `Sorry, but link number ${linkId} (${linkText}) is not clickable, please select another link or another command. You can also try to go to the link URL directly with "goto_url".`;
          }
        }
      }
      print(taskPrefix + "Scraping page...");
      linksAndInputs = await getTabbableElements(page);
    } else if (functionName === "typeText") {
      const formData = funcArguments.form_data;
      let prevInput: ElementHandle | null = null;
      for (const data of formData) {
        const elementId = data.pgpt_id;
        const text = data.text;
        message = "";
        try {
          element = await page.$(".pgpt-element" + elementId);
          if (!element) {
            return;
          }
          if (!prevInput) {
            prevInput = element;
          }
          const name = await element.evaluate((el: Element) => {
            return el.getAttribute("name");
          });
          const type = await element.evaluate((el: Element) => {
            return el.getAttribute("type");
          });
          const tagName = await element.evaluate((el: Element) => {
            return el.tagName;
          });
          // ChatGPT sometimes tries to type empty string
          // to buttons to click them
          if (tagName === "BUTTON" || type === "submit" || type === "button") {
            funcArguments.submit = true;
          } else {
            prevInput = element;
            await element.type(text);
            const sanitized = text.replace("\n", " ");
            print(taskPrefix + `Typing "${sanitized}" to ${name}`);
            message += `Typed "${text}" to input field "${name}"\n`;
          }
        } catch (error) {
          message += `Error typing "${text}" to input field ID ${data.element_id}\n`;
        }
      }

      if (funcArguments.submit !== false) {
        print(taskPrefix + `Submitting form`);
        try {
          const form = await prevInput!.evaluateHandle((input: any) =>
            input.closest("form")
          );
          await form.evaluate((form: HTMLFormElement) => form.submit());
          await waitForNavigation(page);
          const currentUrl = await page.url();
          message += `Form sent! You are now on ${currentUrl}\n`;
        } catch (error) {
          print(taskPrefix + `Error submitting form`);
          message += "There was an error submitting the form.\n";
        }
        print(taskPrefix + "Scraping page...");
        linksAndInputs = await getTabbableElements(page);
      }
    } else if (functionName === "answerUser") {
      print(funcArguments);
      let text = funcArguments.answer;
      if (text === true) {
        logPassedTest();
      } else {
        logFailedTest();
      }
      if (!text) {
        text = funcArguments.summary;
      }
      printCurrentCost(tokenUsage);
      message = "";
      return;
    } else {
      message = "That is an unknown function. Please call another one";
    }

    message = message.substring(0, contextLengthLimit);
    msg = msg ?? {
      role: "function",
      name: functionName,
      content: JSON.stringify({
        status: "OK",
        message: message,
      }),
    };
  } else {
    printCurrentCost(tokenUsage);
    let nextContent = nextStep.content.trim();
    if (nextContent === "") {
      nextContent = "<empty response>";
    }
    msg = {
      role: "user",
      content: message,
    };
  }

  if (noContent !== true) {
    const pageContent = await getPageContent(page);
    msg.content += "\n\n" + pageContent.substring(0, contextLengthLimit);
  }
  msg.url = await page.url();

  // fix here
  nextStep = await sendChatMessage(msg, cases[0].expectedResult, context);
  (msg.content = message), context.push(msg);
  context.push(nextStep);

  await doNextStep(page, context, nextStep, linksAndInputs, element);
};

const main = async () => {
  for (const testCase of cases) {
    console.log("testCase", testCase);
    let context = [
      {
        role: "system",
        content: `
## OBJECTIVE ##
Your assignment is to act as a tester for a designated website, following specific instructions aimed at verifying if the expected results are achieved. This involves utilizing your capabilities to interact with the web, such as navigating through pages, identifying and listing elements, inputting data into search boxes and forms, and clicking on links, all with the goal of emulating human web browsing behavior to ascertain the website's functionality and performance against predefined expectations.
Your instructions are ${testCase.intructions}
The expected result are ${testCase.expectedResult}
## NOTES ##
You will try to navigate directly to the most relevant web address. If you were given a URL, go to it directly. If you encounter a Page Not Found error, try another URL. If multiple URLs don't work, you are probably using an outdated version of the URL scheme of that website. In that case, try navigating to their front page and using their search bar or try navigating to the right place with links.
## WHEN TASK IS FINISHED ##
When you have executed all the operations needed for the original task, call answer_user to give a response to the user.`.trim(),
      },
    ];
    let message = `Task: Go to ${testCase.url} and follow these instruction: ${testCase.intructions}.`;
    let msg = {
      role: "user",
      content: message,
    };
    const response = await sendChatMessage(
      msg,
      testCase.expectedResult,
      context,
      {
        name: "makePlan",
        arguments: ["plan"],
      }
    );
    let args = JSON.parse(response.function_call.arguments);
    print("\n## PLAN ##");
    print(args.plan);
    print("## PLAN ##\n");
    context.push(msg);
    context.push(response);
    const page = await startBrowser();
    await doNextStep(page, context, response, [], null);
    page.close();
  }
};

// Logs successful test cases, indicating the test case name and optional details
export const logPassedTest = (details = "") => {
  console.log(
    `\n%c✅ Passed Test %c\n${details}`,
    "color:#4caf50; background:#e8f5e9; font-size:1.5rem; padding:0.15rem; margin: 1rem auto; font-family: Rockwell, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 2px solid #4caf50; border-radius: 4px; font-weight: bold; text-shadow: 1px 1px 1px #2e7d32;",
    "color: #2e7d32; font-size: 1rem; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;"
  );
};

// Logs failed test cases, including the test case name, failure message, and optional stack trace
export const logFailedTest = (failureMessage = "", stack = "") => {
  console.error(
    `\n%c❌ Failed Test%c\n${failureMessage}\n\n%cIf you think this is a bug, please report it.`,
    "color:#f44336; background:#ffebee; font-size:1.5rem; padding:0.15rem; margin: 1rem auto; font-family: Rockwell, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 2px solid #f44336; border-radius: 4px; font-weight: bold; text-shadow: 1px 1px 1px #d32f2f;",
    "font-weight: bold; font-size: 1rem; color: #d32f2f;",
    "color: #d32f2f; font-size: 0.75rem; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;"
  );
  if (stack) {
    console.error(`%cStack Trace%c\n${stack}`, "font-weight: bold;", "");
  }
};

main();
