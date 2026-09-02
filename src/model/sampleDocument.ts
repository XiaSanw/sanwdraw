import { componentTemplates, instantiateTemplate } from "./templates";
import type { ComponentElement, SanwDocument, TextElement } from "./types";
import { portRef } from "./types";

const fixedInstance = (
  templateId: string,
  id: string,
  x: number,
  y: number,
): ComponentElement => {
  const template = componentTemplates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Missing template: ${templateId}`);
  const instance = instantiateTemplate(template, x, y, { id });
  return {
    ...instance,
    ports: instance.ports.map((port) => ({ ...port, enabled: true })),
  };
};

const sectionLabel = (
  id: string,
  text: string,
  x: number,
  y: number,
  color: string,
): TextElement => ({
  id,
  kind: "text",
  text,
  x,
  y,
  width: 260,
  height: 44,
  zIndex: 2,
  fontSize: 24,
  color,
  weight: 700,
});

export const createSampleDocument = (): SanwDocument => {
  const now = new Date().toISOString();
  return {
    format: "sanwdraw",
    schemaVersion: 1,
    appVersion: "0.1.0",
    id: "document-robot-power-and-control",
    name: "移动机器人 · 电源与接口架构",
    createdAt: now,
    updatedAt: now,
    settings: { portGap: 16 },
    assets: {},
    elements: [
      sectionLabel("label-power", "01 / 电源入口", 130, 105, "#b76115"),
      sectionLabel("label-control", "02 / 控制与通信", 520, 105, "#3458b8"),
      sectionLabel("label-field", "03 / 现场设备", 1140, 105, "#15765c"),
      fixedInstance("dc-dc-24v", "dc-main", 140, 360),
      fixedInstance("stm32-main", "stm32-main", 535, 245),
      fixedInstance("dji-center", "dji-center", 515, 650),
      fixedInstance("esp32-gateway", "esp-gateway", 1080, 230),
      fixedInstance("npn-photo-gate", "photo-gate", 1065, 510),
      fixedInstance("opto-24-3v3", "opto-board", 1500, 500),
      fixedInstance("dji-motor", "dji-motor-1", 1120, 810),
      fixedInstance("bts7960", "bts-1", 1500, 800),
      fixedInstance("servo", "servo-1", 1120, 1080),
    ],
    networks: [
      {
        id: "net-24v-main",
        name: "24V 主电源母线",
        domain: "power",
        memberIds: [
          portRef("dc-main", "24v-out"),
          portRef("stm32-main", "24v"),
          portRef("dji-center", "24v-in"),
          portRef("esp-gateway", "24v"),
          portRef("photo-gate", "24v"),
        ],
        color: "#df7b23",
        junction: { x: 410, y: 475 },
      },
      {
        id: "net-can-main",
        name: "CAN BUS A",
        domain: "signal",
        protocol: "CAN",
        memberIds: [
          portRef("stm32-main", "can1"),
          portRef("dji-center", "can-1"),
          portRef("esp-gateway", "can"),
        ],
        color: "#3472d1",
        junction: { x: 930, y: 405 },
      },
      {
        id: "net-photo-npn",
        name: "光电门 NPN 开关量",
        domain: "signal",
        protocol: "NPN",
        memberIds: [
          portRef("photo-gate", "npn"),
          portRef("opto-board", "24v-in"),
        ],
        color: "#15926b",
      },
      {
        id: "net-opto-gpio",
        name: "隔离后 3.3V GPIO",
        domain: "signal",
        protocol: "GPIO",
        memberIds: [
          portRef("opto-board", "3v3-out"),
          portRef("stm32-main", "gpio"),
        ],
        color: "#0785a5",
      },
      {
        id: "net-motor-power",
        name: "电机 1 · 24V",
        domain: "power",
        memberIds: [
          portRef("dji-center", "24v-1"),
          portRef("dji-motor-1", "24v"),
        ],
        color: "#c35d2e",
      },
      {
        id: "net-motor-can",
        name: "电机 1 · CAN",
        domain: "signal",
        protocol: "CAN",
        memberIds: [
          portRef("dji-center", "can-2"),
          portRef("dji-motor-1", "can"),
        ],
        color: "#3472d1",
      },
      {
        id: "net-bts-power",
        name: "BTS7960 · 24V",
        domain: "power",
        memberIds: [
          portRef("dji-center", "24v-4"),
          portRef("bts-1", "24v"),
        ],
        color: "#c24f43",
      },
      {
        id: "net-bts-pwm",
        name: "BTS7960 · PWM",
        domain: "signal",
        protocol: "PWM",
        memberIds: [
          portRef("stm32-main", "pwm"),
          portRef("bts-1", "pwm"),
        ],
        color: "#97506e",
      },
    ],
  };
};
