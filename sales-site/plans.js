const pricing = document.querySelector("#pricing");
const toggle = pricing.querySelector(".plan-toggle");
const deadline = Date.parse("2026-12-15T06:00:00Z");
function updatePlans() {
  const available = Date.now() < deadline;
  toggle.hidden = !available;
  pricing.querySelector("#annual-sale").hidden = !available;
  const annual = available && toggle.querySelector(":checked").value === "annual";
  pricing.querySelector("#plan-terms").textContent = annual
    ? "Annual prices are prepaid and include 12 months of service. Optional marketing and usage charges are separate."
    : "Monthly billing includes a $997 one-time onboarding fee.";
  for (const card of pricing.querySelectorAll(".plan-card")) {
    const amount = Number(card.dataset.rate) * (annual ? 10 : 1);
    card.querySelector("strong").textContent = "$" + amount.toLocaleString("en-US");
    card.querySelector(".plan-price span").textContent = annual ? "/ year" : "/ month";
    const link = card.querySelector("a");
    link.href = "/signup.html?plan=" + card.dataset.plan + (annual ? "&term=annual_bf26" : "");
    link.setAttribute("aria-label", "Choose " + card.querySelector("h4").textContent + (annual ? " annually" : " monthly"));
  }
}
toggle.addEventListener("change", updatePlans);
window.addEventListener("pageshow", updatePlans);
updatePlans();
