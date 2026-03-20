import math

def calculate_doppler_effect(frequency_0, velocity, c=299792458):
    """
    Calculate the Doppler effect.

    Parameters:
        frequency_0 (float): The original frequency.
        velocity (float): The velocity of the observer or source.
        c (float): The speed of light. Default is 299792458 m/s.

    Returns:
        float: The observed frequency.
    """
    velocity_ratio = velocity / c
    observed_frequency = frequency_0 * math.sqrt((1 + velocity_ratio) / (1 - velocity_ratio))
    return observed_frequency

def main():
    # Example usage
    original_frequency = 100e6  # Hz
    velocity = 500000  # m/s
    speed_of_light = 299792458  # m/s

    observed_frequency = calculate_doppler_effect(original_frequency, velocity, speed_of_light)
    print(f"Original frequency: {original_frequency} Hz")
    print(f"Velocity: {velocity} m/s")
    print(f"Observed frequency: {observed_frequency:.2e} Hz")

if __name__ == "__main__":
    main()
