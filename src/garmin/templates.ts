// Workout JSON templates — verbatim data port of workout_templates.py
// (originally exposed as MCP resources; here as tools + upload_workout input).

export const INTERVAL_RUNNING_TEMPLATE: unknown = {
  "workoutName": "Interval Run",
  "description": "Interval workout with repeat groups: warmup, 6x(400m fast + 2min recovery), cooldown",
  "sportType": {
    "sportTypeId": 1,
    "sportTypeKey": "running"
  },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": {
        "sportTypeId": 1,
        "sportTypeKey": "running"
      },
      "workoutSteps": [
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 1,
          "stepType": {
            "stepTypeId": 1,
            "stepTypeKey": "warmup"
          },
          "description": "Warmup 10 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 600.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        },
        {
          "type": "RepeatGroupDTO",
          "stepOrder": 2,
          "numberOfIterations": 6,
          "workoutSteps": [
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 1,
              "stepType": {
                "stepTypeId": 3,
                "stepTypeKey": "interval"
              },
              "description": "Fast 400m",
              "endCondition": {
                "conditionTypeId": 3,
                "conditionTypeKey": "distance"
              },
              "endConditionValue": 400.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              }
            },
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 2,
              "stepType": {
                "stepTypeId": 4,
                "stepTypeKey": "recovery"
              },
              "description": "Recovery 2 min",
              "endCondition": {
                "conditionTypeId": 2,
                "conditionTypeKey": "time"
              },
              "endConditionValue": 120.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              }
            }
          ]
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 3,
          "stepType": {
            "stepTypeId": 2,
            "stepTypeKey": "cooldown"
          },
          "description": "Cooldown 10 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 600.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        }
      ]
    }
  ]
};

export const SIMPLE_RUN_TEMPLATE: unknown = {
  "workoutName": "Simple Run",
  "description": "Basic run workout: warmup, run, cooldown",
  "sportType": {
    "sportTypeId": 1,
    "sportTypeKey": "running"
  },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": {
        "sportTypeId": 1,
        "sportTypeKey": "running"
      },
      "workoutSteps": [
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 1,
          "stepType": {
            "stepTypeId": 1,
            "stepTypeKey": "warmup"
          },
          "description": "Warmup 5 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 300.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 2,
          "stepType": {
            "stepTypeId": 3,
            "stepTypeKey": "interval"
          },
          "description": "Run 20 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 1200.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 3,
          "stepType": {
            "stepTypeId": 2,
            "stepTypeKey": "cooldown"
          },
          "description": "Cooldown 5 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 300.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        }
      ]
    }
  ]
};

export const STRENGTH_CIRCUIT_TEMPLATE: unknown = {
  "workoutName": "Strength Circuit",
  "description": "Strength training circuit: warmup, 3x circuit (work + rest), cooldown",
  "sportType": {
    "sportTypeId": 5,
    "sportTypeKey": "strength_training"
  },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": {
        "sportTypeId": 5,
        "sportTypeKey": "strength_training"
      },
      "workoutSteps": [
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 1,
          "stepType": {
            "stepTypeId": 1,
            "stepTypeKey": "warmup"
          },
          "description": "Warmup 5 min",
          "endCondition": {
            "conditionTypeId": 1,
            "conditionTypeKey": "lap.button"
          },
          "endConditionValue": 10.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          },
          "category": "CARDIO",
          "exerciseName": ""
        },
        {
          "type": "RepeatGroupDTO",
          "stepOrder": 2,
          "numberOfIterations": 3,
          "workoutSteps": [
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 1,
              "stepType": {
                "stepTypeId": 3,
                "stepTypeKey": "interval"
              },
              "description": "Bench Press 10 reps",
              "endCondition": {
                "conditionTypeId": 10,
                "conditionTypeKey": "reps"
              },
              "endConditionValue": 10.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              },
              "category": "BENCH_PRESS",
              "exerciseName": "BARBELL_BENCH_PRESS"
            },
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 2,
              "stepType": {
                "stepTypeId": 5,
                "stepTypeKey": "rest"
              },
              "description": "Rest 2 min",
              "endCondition": {
                "conditionTypeId": 2,
                "conditionTypeKey": "time"
              },
              "endConditionValue": 120.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              }
            }
          ]
        },
        {
          "type": "RepeatGroupDTO",
          "stepOrder": 3,
          "numberOfIterations": 3,
          "workoutSteps": [
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 1,
              "stepType": {
                "stepTypeId": 3,
                "stepTypeKey": "interval"
              },
              "description": "Pull-ups 8 reps",
              "endCondition": {
                "conditionTypeId": 10,
                "conditionTypeKey": "reps"
              },
              "endConditionValue": 8.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              },
              "category": "PULL_UP",
              "exerciseName": "PULL_UP"
            },
            {
              "type": "ExecutableStepDTO",
              "stepOrder": 2,
              "stepType": {
                "stepTypeId": 5,
                "stepTypeKey": "rest"
              },
              "description": "Rest 2 min",
              "endCondition": {
                "conditionTypeId": 2,
                "conditionTypeKey": "time"
              },
              "endConditionValue": 120.0,
              "targetType": {
                "workoutTargetTypeId": 1,
                "workoutTargetTypeKey": "no.target"
              }
            }
          ]
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 4,
          "stepType": {
            "stepTypeId": 2,
            "stepTypeKey": "cooldown"
          },
          "description": "Cooldown stretch 5 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 300.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        }
      ]
    }
  ]
};

export const TEMPO_RUN_TEMPLATE: unknown = {
  "workoutName": "Tempo Run",
  "description": "Tempo workout: warmup, 20min at tempo pace (HR zone 4), cooldown",
  "sportType": {
    "sportTypeId": 1,
    "sportTypeKey": "running"
  },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": {
        "sportTypeId": 1,
        "sportTypeKey": "running"
      },
      "workoutSteps": [
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 1,
          "stepType": {
            "stepTypeId": 1,
            "stepTypeKey": "warmup"
          },
          "description": "Warmup 10 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 600.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 2,
          "stepType": {
            "stepTypeId": 3,
            "stepTypeKey": "interval"
          },
          "description": "Tempo 20 min - HR Zone 4",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 1200.0,
          "targetType": {
            "workoutTargetTypeId": 4,
            "workoutTargetTypeKey": "heart.rate.zone"
          },
          "zoneNumber": 4
        },
        {
          "type": "ExecutableStepDTO",
          "stepOrder": 3,
          "stepType": {
            "stepTypeId": 2,
            "stepTypeKey": "cooldown"
          },
          "description": "Cooldown 10 min",
          "endCondition": {
            "conditionTypeId": 2,
            "conditionTypeKey": "time"
          },
          "endConditionValue": 600.0,
          "targetType": {
            "workoutTargetTypeId": 1,
            "workoutTargetTypeKey": "no.target"
          }
        }
      ]
    }
  ]
};

export const WORKOUT_STRUCTURE_REFERENCE: unknown = {
  "description": "Reference guide for Garmin workout JSON structure",
  "step_types": {
    "ExecutableStepDTO": "Regular workout step (warmup, interval, cooldown, recovery, rest)",
    "RepeatGroupDTO": "Repeat group containing nested steps with numberOfIterations"
  },
  "stepType_values": {
    "1": {
      "stepTypeKey": "warmup",
      "description": "Warmup phase"
    },
    "2": {
      "stepTypeKey": "cooldown",
      "description": "Cooldown phase"
    },
    "3": {
      "stepTypeKey": "interval",
      "description": "Work/effort interval (use for exercises in strength workouts)"
    },
    "4": {
      "stepTypeKey": "recovery",
      "description": "Recovery between intervals (active recovery)"
    },
    "5": {
      "stepTypeKey": "rest",
      "description": "Complete rest (use for rest between sets in strength workouts)"
    },
    "6": {
      "stepTypeKey": "repeat",
      "description": "Repeat group step type (used internally by RepeatGroupDTO)"
    }
  },
  "endCondition_values": {
    "1": {
      "conditionTypeKey": "lap.button",
      "description": "Manual lap press (use for warmup/cooldown in strength workouts)"
    },
    "2": {
      "conditionTypeKey": "time",
      "description": "Duration in seconds"
    },
    "3": {
      "conditionTypeKey": "distance",
      "description": "Distance in meters"
    },
    "4": {
      "conditionTypeKey": "calories",
      "description": "Calories in kcal"
    },
    "5": {
      "conditionTypeKey": "power",
      "description": "Power in watts"
    },
    "6": {
      "conditionTypeKey": "heart.rate",
      "description": "Heart rate in bpm"
    },
    "7": {
      "conditionTypeKey": "iterations",
      "description": "Number of iterations (used internally by RepeatGroupDTO)"
    },
    "8": {
      "conditionTypeKey": "fixed.rest",
      "description": "Fixed rest duration"
    },
    "9": {
      "conditionTypeKey": "fixed.repetition",
      "description": "Fixed repetition count"
    },
    "10": {
      "conditionTypeKey": "reps",
      "description": "Number of repetitions (use for strength exercises)"
    },
    "11": {
      "conditionTypeKey": "training.peaks.tss",
      "description": "TrainingPeaks TSS"
    }
  },
  "targetType_values": {
    "1": {
      "workoutTargetTypeKey": "no.target",
      "description": "No specific target"
    },
    "2": {
      "workoutTargetTypeKey": "power.zone",
      "description": "Cycling power zone 1-7 (use zoneNumber; based on FTP %). Do NOT use for absolute watt targets."
    },
    "4": {
      "workoutTargetTypeKey": "heart.rate.zone",
      "description": "Heart rate zone (use zoneNumber 1-5 for named zones, or targetValueOne/targetValueTwo for custom bpm range)"
    },
    "6 (running/swim)": {
      "workoutTargetTypeKey": "pace.zone",
      "description": "Pace zone for running or swimming (use zoneNumber, or step-level targetValueOne/targetValueTwo in m/s for a custom range)"
    },
    "6 (cycling)": {
      "workoutTargetTypeKey": "power.between",
      "description": "Cycling absolute watt range (use targetValueOne=low_watts, targetValueTwo=high_watts). Use this instead of power.zone when targeting specific watts, NOT zone numbers."
    }
  },
  "sportType_values": {
    "1": {
      "sportTypeKey": "running"
    },
    "2": {
      "sportTypeKey": "cycling"
    },
    "3": {
      "sportTypeKey": "other"
    },
    "4": {
      "sportTypeKey": "lap_swimming"
    },
    "5": {
      "sportTypeKey": "strength_training"
    },
    "6": {
      "sportTypeKey": "cardio_training"
    },
    "7": {
      "sportTypeKey": "yoga"
    },
    "8": {
      "sportTypeKey": "pilates"
    },
    "9": {
      "sportTypeKey": "hiit"
    },
    "11": {
      "sportTypeKey": "mobility"
    },
    "12": {
      "sportTypeKey": "walking"
    },
    "13": {
      "sportTypeKey": "rucking"
    }
  },
  "strength_training_fields": {
    "description": "Additional fields for strength training workout steps (ExecutableStepDTO)",
    "category": "Exercise category (e.g., BENCH_PRESS, PULL_UP, CURL, SHOULDER_PRESS, ROW, SQUAT, DEADLIFT, TRICEPS_EXTENSION, PLANK, LUNGE, CARDIO)",
    "exerciseName": "Specific exercise name (e.g., BARBELL_BENCH_PRESS, PULL_UP, DUMBBELL_BICEPS_CURL, DUMBBELL_SHOULDER_PRESS, BENT_OVER_ROW_WITH_DUMBELL, BODY_WEIGHT_DIP)",
    "weightValue": "Weight value as number (e.g., 24.0)",
    "weightUnit": "Weight unit object: {\"unitId\": 8, \"unitKey\": \"kilogram\", \"factor\": 1000.0}"
  }
};
