"""Enable vehicle inquiries on the shared showroom tool and the agents passed on the CLI."""
import json
import os
import sys
from urllib.request import Request, urlopen

TOOL = "tool_4401m87tye1kfhe9g57skerqtb32"
GUIDANCE = (
    "When a shopper asks about a specific vehicle, offer to send their question to the dealership. "
    "Use the selected listing, or identify and open the exact vehicle first. Ask for their name and callback phone, "
    "one missing detail at a time. Keep their question in their own words. Email is not required. "
    "Use shopper_action with workflow vehicle_inquiry, selected VIN as car_id, name, phone, and question as message. "
    "Once they agree to send it, set submit true. Report delivery only after submitted:true and mention the returned stock number."
)


def api(path, change=None):
    data = None if change is None else json.dumps(change).encode()
    request = Request("https://api.elevenlabs.io/v1/convai/" + path, data=data,
                      method="GET" if data is None else "PATCH",
                      headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json"})
    with urlopen(request, timeout=25) as response:
        return json.load(response)


def main(agents):
    path = "tools/" + TOOL
    config = api(path)["tool_config"]
    if config["name"] != "shopper_action":
        raise ValueError("Unexpected showroom tool")
    props = config["parameters"]["properties"]
    if "vehicle_inquiry" not in props["workflow"]["description"]:
        config["description"] += " Also collect and submit a shopper's vehicle question to the dealership inbox."
        props["workflow"]["description"] += ", vehicle_inquiry"
        props["car_id"] = {"type":"string","description":"For vehicle_inquiry submit the VIN of the shopper's selected listing."}
        props["message"]["description"] += ". For vehicle_inquiry, the shopper's actual question."
        props["phone"]["description"] += ". Required callback number for vehicle_inquiry."
        props["submit"]["description"] += " For an inquiry, true when the shopper agrees to send their question."
        api(path, {"tool_config": config})
    assert "car_id" in api(path)["tool_config"]["parameters"]["properties"]
    for agent in agents:
        path = "agents/" + agent
        prompt = api(path)["conversation_config"]["agent"]["prompt"]
        if TOOL not in prompt["tool_ids"]:
            raise ValueError("Agent does not use the showroom tool: " + agent)
        if GUIDANCE not in prompt["prompt"]:
            api(path, {"conversation_config":{"agent":{"prompt":{"prompt":prompt["prompt"]+"\n\n"+GUIDANCE,"tool_ids":prompt["tool_ids"]}}}})
        confirmed = api(path)["conversation_config"]["agent"]["prompt"]
        assert GUIDANCE in confirmed["prompt"] and confirmed["tool_ids"] == prompt["tool_ids"]
        print("Verified", agent)


if __name__ == "__main__":
    main(sys.argv[1:])
