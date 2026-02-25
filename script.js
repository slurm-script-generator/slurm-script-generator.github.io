const output = document.getElementById("output");
const runBtn = document.getElementById("run-btn");
const loadOverlay = document.getElementById("loading-overlay");
const formEl = document.getElementById("dynamic-form");

let pyodide = null;

async function init() {
  try {
    pyodide = await loadPyodide();
    await pyodide.loadPackage("micropip");

    await pyodide.runPythonAsync(`
import micropip
import inspect
import json

# 1. Install the package from PyPI
await micropip.install("slurm-script-generator")

from slurm_script_generator.slurm_script import SlurmScript
from slurm_script_generator import pragmas
from slurm_script_generator.pragmas import Pragma

# 2. Initialize the dictionary using the order from SlurmScript
# We create an instance to access the _pragma_dict attribute
ordered_keys = list(SlurmScript()._pragma_dict.keys())
meta = {key: [] for key in ordered_keys}

# 3. Populate metadata
for name, obj in inspect.getmembers(pragmas):
    if inspect.isclass(obj) and issubclass(obj, Pragma) and obj is not Pragma:
        p_type = getattr(obj, "pragma_type", "other")
        
        # If a type exists that wasn't in your dict, add it to the end
        if p_type not in meta:
            meta[p_type] = []
            
        meta[p_type].append({
            "id": obj.arg_varname,
            "label": name.replace('_', ' '),
            "help": obj.help,
            "example": getattr(obj, "example", ""),
            "is_bool": getattr(obj, "action", "") == "store_true"
        })

# 4. Cleanup: Remove categories that have no items (e.g., if some sections are empty)
# This keeps the UI clean.
meta = {k: v for k, v in meta.items() if v}

# Store result for JS to pick up
global_meta = json.dumps(meta)
`);

    // Retrieve the metadata from Python
    const pragmaMeta = JSON.parse(pyodide.globals.get("global_meta"));
    renderForm(pragmaMeta);

    loadOverlay.style.display = "none";
    runBtn.disabled = false;
  } catch (err) {
    document.getElementById("load-msg").innerHTML =
      `<div style="color: #ef4444;">Failed to load from PyPI</div>
            <div style="font-size: 0.8rem;">${err.message}</div>`;
  }
}

function renderForm(data) {
  for (const [category, items] of Object.entries(data)) {
    const section = document.createElement("div");
    section.className = "category-section";

    const title = document.createElement("div");
    title.className = "category-title";
    title.innerText = category.replace(/_/g, " ");
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "grid-inputs";

    items.forEach((item) => {
      const field = document.createElement("div");
      field.className = "field";

      if (item.is_bool) {
        field.style.flexDirection = "row";
        field.style.alignItems = "center";
        field.innerHTML = `
                <input type="checkbox" id="${item.id}" class="slurm-val">
                <label for="${item.id}">${item.label}</label>
            `;
      } else {
        field.innerHTML = `
                <label title="${item.help}">${item.label}</label>
                <input type="text" id="${item.id}" class="slurm-val" placeholder="${item.example || ""}">
            `;
      }
      grid.appendChild(field);
    });

    section.appendChild(grid);
    formEl.appendChild(section);
  }
}

runBtn.onclick = async () => {
  // Initialize the nested structure your from_dict method wants
  const nestedConfig = {
    pragmas: {},
    modules: [],
    custom_commands: [],
  };

  // 1. Collect Slurm Pragmas (the dynamic textboxes)
  document.querySelectorAll(".slurm-val").forEach((el) => {
    if (el.type === "checkbox") {
      if (el.checked) nestedConfig.pragmas[el.id] = "true";
    } else if (el.value.trim() !== "") {
      nestedConfig.pragmas[el.id] = el.value.trim();
    }
  });

  // 2. Collect Modules & Commands (the textareas)
  const modulesText = document.getElementById("modules").value;
  nestedConfig.modules = modulesText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const commandsText = document.getElementById("custom_commands").value;
  nestedConfig.custom_commands = commandsText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  try {
    // Pass the nested JS object to Pyodide
    pyodide.globals.set("user_payload", pyodide.toPy(nestedConfig));

    const scriptContent = await pyodide.runPythonAsync(`
from slurm_script_generator.slurm_script import SlurmScript

# Use your static method to rebuild the instance
script_obj = SlurmScript.from_dict(user_payload)
script_obj.generate_script(include_header=True)
    `);

    output.textContent = scriptContent;
  } catch (err) {
    output.textContent = "Error using from_dict:\n" + err;
  }
};

// --- Draggable Divider Logic ---
const resizer = document.getElementById("resizer");
const mainContainer = document.querySelector("main");

resizer.addEventListener("mousedown", (e) => {
  document.body.classList.add("is-dragging");
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", stopResizing);
});

function handleMouseMove(e) {
  // Calculate the new width based on mouse position
  const containerRect = mainContainer.getBoundingClientRect();
  const newLeftWidth = e.clientX - containerRect.left;

  // Set constraints (e.g., sidebars can't be smaller than 250px)
  const minWidth = 250;
  const maxWidth = containerRect.width - 250;

  if (newLeftWidth > minWidth && newLeftWidth < maxWidth) {
    mainContainer.style.gridTemplateColumns = `${newLeftWidth}px 8px 1fr`;
  }
}

function stopResizing() {
  document.body.classList.remove("is-dragging");
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", stopResizing);
}

// Button to copy output to clipboard
const copyBtn = document.getElementById("copy-btn");

copyBtn.onclick = async () => {
  const content = output.textContent;

  // Don't copy the placeholder text
  if (content.startsWith("# Your generated script")) return;

  try {
    await navigator.clipboard.writeText(content);

    // Visual feedback
    const originalText = copyBtn.innerText;
    copyBtn.innerText = "✓ Copied!";
    copyBtn.classList.add("success");

    setTimeout(() => {
      copyBtn.innerText = originalText;
      copyBtn.classList.remove("success");
    }, 2000);
  } catch (err) {
    console.error("Failed to copy!", err);
    alert("Failed to copy to clipboard.");
  }
};

init();
