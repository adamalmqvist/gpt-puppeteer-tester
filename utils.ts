import { Element, model, navigationTimeout } from ".";
import readline from "readline";
import cheerio from "cheerio";
import { Page } from "puppeteer";

export const getTokenPrice = (model: string, direction: string) => {
  let tokenPriceInput = 0.0;
  let tokenPriceOutput = 0.0;
  if (model.indexOf("gpt-4-32k") === 0) {
    tokenPriceInput = 0.06 / 1000;
    tokenPriceOutput = 0.12 / 1000;
  } else if (model.indexOf("gpt-4") === 0) {
    tokenPriceInput = 0.03 / 1000;
    tokenPriceOutput = 0.06 / 1000;
  } else if (model.indexOf("gpt-3.5-turbo-16k") === 0) {
    tokenPriceInput = 0.003 / 1000;
    tokenPriceOutput = 0.004 / 1000;
  } else if (model.indexOf("gpt-3.5-turbo") === 0) {
    tokenPriceInput = 0.0015 / 1000;
    tokenPriceOutput = 0.002 / 1000;
  }
  if (direction == "input") {
    return tokenPriceInput;
  } else {
    return tokenPriceOutput;
  }
};

export const tokenCost = (
  promptTokens: number,
  completionTokens: number,
  model: string
) => {
  let promptPrice = getTokenPrice(model, "input");
  let completionPrice = getTokenPrice(model, "output");
  return promptTokens * promptPrice + completionTokens * completionPrice;
};

export const round = (number: number, decimals: number) => {
  return number.toFixed(decimals);
};

export const print = (message = "") => {
  console.log(message);
};

export const printCurrentCost = (tokenUsage: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}) => {
  let cost = tokenCost(
    tokenUsage.promptTokens,
    tokenUsage.completionTokens,
    model
  );
  print(
    "Current cost: " +
      round(cost, 2) +
      " USD (" +
      tokenUsage.totalTokens +
      " tokens)"
  );
};

export const inArray = (element: any, array: any[]) => {
  for (let i = 0; i < array.length; i++) {
    if (array[i] == element) {
      return true;
    }
  }
  return false;
};

export const input = async (text: string) => {
  let thePrompt;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await (async () => {
    return new Promise<void>((resolve) => {
      rl.question(text, (prompt) => {
        thePrompt = prompt;
        rl.close();
        resolve();
      });
    });
  })();
  return thePrompt;
};

export const redactMessages = (messages: any[]) => {
  let redactedMessages: any[] = [];
  let currentUrl = messages[messages.length - 1].url;
  messages.forEach((message) => {
    let msg = JSON.parse(JSON.stringify(message));
    delete msg.redacted;
    delete msg.url;
    redactedMessages.push(msg);
  });
  return redactedMessages;
};

export const goodHtml = (html: string) => {
  html = html.replace(/<\//g, " </");
  let $ = cheerio.load(html);
  $("script, style").remove();
  let important = [
    "main",
    '[role="main"]',
    "#bodyContent",
    "#search",
    "#searchform",
    ".kp-header",
  ];
  // move important content to top
  // important.forEach((im) => {
  //   $(im).each((i, el) => {
  //     $(el).prependTo(el.);
  //   });
  // });
  return $;
};

const makeTag = (element: Element): any => {
  const $ = cheerio;
  let textContent = $(element).text().replace(/\s+/g, " ").trim();
  let placeholder = $(element).attr("placeholder");
  let tagName = element.name;
  let title = $(element).attr("title");
  let value = $(element).attr("value");
  let role = $(element).attr("role");
  let type = $(element).attr("type");
  let href = $(element).attr("href");
  let pgptId = $(element).attr("pgpt-id");
  if (href && href.length > 32) {
    href = href.substring(0, 32) + "[..]";
  }
  if (placeholder && placeholder.length > 32) {
    placeholder = placeholder.substring(0, 32) + "[..]";
  }
  if (title && title.length > 32) {
    title = title.substring(0, 32) + "[..]";
  }
  if (textContent && textContent.length > 200) {
    textContent = textContent.substring(0, 200) + "[..]";
  }
  let tag = `<${tagName}`;
  if (href) {
    tag += ` href="${href}"`;
  }
  if (type) {
    tag += ` type="${type}"`;
  }
  if (placeholder) {
    tag += ` placeholder="${placeholder}"`;
  }
  if (title) {
    tag += ` title="${title}"`;
  }
  if (role) {
    tag += ` role="${role}"`;
  }
  if (value) {
    tag += ` value="${value}"`;
  }
  if (pgptId) {
    tag += ` pgpt-id="${pgptId}"`;
  }
  tag += `>`;
  let obj = {
    tag: tag,
    text: "",
  };
  if (textContent) {
    obj.text = textContent;
    obj.tag += `${textContent}</${tagName}>`;
  }
  return obj;
};

export const checkDownloadError = (error: any): string | null => {
  if (error instanceof Error && error.message.startsWith("net::ERR_ABORTED")) {
    return "NOTICE: The connection was aborted. If you clicked on a download link, the file has been downloaded to the default Chrome downloads location.";
  }
  return null;
};

export const getPageContent = async (page: Page): Promise<string> => {
  const title = await page.evaluate(() => {
    return document.title;
  });
  const html = await page.evaluate(() => {
    return document.body.innerHTML;
  });
  return (
    "## START OF PAGE CONTENT ##\nTitle: " +
    title +
    "\n\n" +
    uglyChowder(html) +
    "\n## END OF PAGE CONTENT ##"
  );
};

export const waitForNavigation = async (page: Page): Promise<void> => {
  try {
    await page.waitForNavigation({
      timeout: navigationTimeout,
    });
  } catch (error) {
    print("NOTICE: Giving up on waiting for navigation");
  }
};

const uglyChowder = (html: string) => {
  const $ = goodHtml("<body>" + html + "</body>");
  const traverse = (element: Element) => {
    let output = "";
    let children = element.children;
    if ($(element).is("h1, h2, h3, h4, h5, h6")) {
      output += "<" + element.name + ">";
    }
    if ($(element).is("form")) {
      output += "\n<" + element.name + ">\n";
    }
    if ($(element).is("div, section, main")) {
      output += "\n";
    }
    let theTag = makeTag(element);
    if ($(element).attr("pgpt-id")) {
      output += " " + (theTag.tag ? theTag.tag : "");
    } else if (element.type === "text" && !$(element.parent).attr("pgpt-id")) {
      output += " " + element.data.trim();
    }
    if (children) {
      children.forEach((child: any) => {
        output += traverse(child);
      });
    }
    if ($(element).is("h1, h2, h3, h4, h5, h6")) {
      output += "</" + element.name + ">";
    }
    if ($(element).is("form")) {
      output += "\n</" + element.name + ">\n";
    }
    if ($(element).is("h1, h2, h3, h4, h5, h6, div, section, main")) {
      output += "\n";
    }
    return output
      .replace(/[^\S\n]+/g, " ")
      .replace(/ \n+/g, "\n")
      .replace(/[\n]+/g, "\n");
  };
  return traverse($("body")[0]);
};

export const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const getTabbableElements = async (
  page: Page,
  selector = "*"
): Promise<any[]> => {
  let tabbableElements: any[] = [];
  let skipped: any[] = [];
  let id = 0;
  let elements = await page.$$(
    'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), select:not([disabled]), a[href]:not([href="javascript:void(0)"]):not([href="#"])'
  );
  let limit = 400;
  for (const element of elements) {
    if (--limit < 0) {
      break;
    }
    const nextTab = await getNextTab(page, element, ++id, selector);
    if (nextTab !== false) {
      tabbableElements.push(nextTab);
    }
  }
  return tabbableElements;
};

export const getNextTab = async (
  page: Page,
  element: Element,
  id: number,
  selector = "*"
): Promise<any | false> => {
  let obj = await page.evaluate(
    async (element, id, selector) => {
      if (!element.matches(selector)) {
        return false;
      }
      const tagName = element.tagName;
      if (tagName === "BODY") {
        return false;
      }
      let textContent = element.textContent.replace(/\s+/g, " ").trim();
      if (textContent === "" && !element.matches("select, input, textarea")) {
        return false;
      }
      element.classList.add("pgpt-element" + id);
      let role = element.role;
      let placeholder = element.placeholder;
      let title = element.title;
      let type = element.type;
      let href = element.href;
      let value = element.value;
      if (href && href.length > 32) {
        href = href.substring(0, 32) + "[..]";
      }
      if (placeholder && placeholder.length > 32) {
        placeholder = placeholder.substring(0, 32) + "[..]";
      }
      if (!textContent && title && title.length > 32) {
        title = title.substring(0, 32) + "[..]";
      }
      if (textContent && textContent.length > 200) {
        textContent = textContent.substring(0, 200) + "[..]";
      }
      let tag = `<${tagName}`;
      if (href) {
        tag += ` href="${href}"`;
      }
      if (type) {
        tag += ` type="${type}"`;
      }
      if (placeholder) {
        tag += ` placeholder="${placeholder}"`;
      }
      if (title) {
        tag += ` title="${title}"`;
      }
      if (role) {
        tag += ` role="${role}"`;
      }
      if (value) {
        tag += ` value="${value}"`;
      }
      tag += `>`;
      let obj = {
        tag: tag,
        id: id,
        text: "",
      };
      if (textContent) {
        obj.text = textContent;
      }
      return obj;
    },
    element,
    id,
    selector
  );
  if (!obj) {
    return false;
  }
  const visible = await page.evaluate(async (id) => {
    const element = document.querySelector(".pgpt-element" + id) as Element;
    if (!element) {
      return false;
    }
    const visibility = element.style.visibility;
    const display = element.style.display;
    const clip = element.style.clip;
    const rect = element.getBoundingClientRect();
    return (
      visibility !== "hidden" &&
      display !== "none" &&
      rect.width != 0 &&
      rect.height != 0 &&
      clip !== "rect(1px, 1px, 1px, 1px)" &&
      clip !== "rect(0px, 0px, 0px, 0px)"
    );
  }, id);
  if (!visible) {
    return false;
  } else {
    await page.evaluate(async (id) => {
      const element = document.querySelector(".pgpt-element" + id) as Element;
      element.setAttribute("pgpt-id", id);
      element.style.border = "1px solid red";
    }, id);
  }
  return obj;
};
