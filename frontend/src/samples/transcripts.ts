import type { Patient } from '../api/types';

export interface SampleTranscript {
  id: string;
  label: string;
  description: string;
  patient: Patient;
  /** Suggested template appointment_type, used to pre-select a template. */
  appointment_type: string;
  text: string;
}

export const SAMPLE_TRANSCRIPTS: SampleTranscript[] = [
  {
    id: 'canine-otitis',
    label: 'Dog with itchy ears (otitis)',
    description: 'Sick visit, canine, 3 weeks of head shaking',
    appointment_type: 'sick',
    patient: { name: 'Biscuit', species: 'canine', breed: 'Labrador Retriever', age: '6 years', sex: 'Male, neutered', weight: '34.2 kg' },
    text: `Vet: Good morning, I'm Dr. Patel. This must be Biscuit. What's been going on with him?
Owner: Hi, yes. He's been shaking his head and scratching at his ears for about three weeks now. It's mostly the left one, but the right one seems itchy too. Last weekend he yelped when I touched near it.
Vet: Okay. Any discharge or smell that you've noticed?
Owner: Yes, there's a brownish gunk and it smells kind of yeasty, sour. Worse since we went to the lake. He swims a lot in the summer, pretty much every day.
Vet: That's helpful. How's his appetite and energy?
Owner: Totally normal. He's eating his kibble, drinking normally, still wants to play fetch. He's just irritated by the ears. He's also been licking his paws a bit more than usual lately.
Vet: Any vomiting or diarrhea?
Owner: No, nothing like that. Stools are normal.
Vet: Has he had ear problems before?
Owner: One infection about two years ago, the right ear. We used drops and it cleared up. He's on a chicken-based food, and we do heartworm and flea prevention every month, never miss it.
Vet: Great. Let me examine him. Temperature is 101.6 Fahrenheit. Heart rate is 96, regular, no murmur. Respiratory rate 24. He weighs 34.2 kilograms, that's down a little from 35 at his last visit, body condition score 5 out of 9, which is ideal. Mucous membranes pink and moist, capillary refill under two seconds. Eyes clear, nose clear. Lymph nodes normal size.
Vet: Now the ears. Left ear canal is quite red and swollen, with a lot of dark brown waxy discharge. He's painful when I handle the base of the ear. I can't see the eardrum on that side because of the debris and swelling. The right ear is mildly erythematous with some similar discharge but less swollen. Let me do a cytology.
Vet: Okay, on the cytology from the left ear I'm seeing lots of yeast, Malassezia, and a moderate number of rod-shaped bacteria. Right ear is mostly yeast. So this looks like a bilateral otitis externa, yeast and bacterial, left worse than right.
Owner: Is it serious? Will he need surgery?
Vet: No, not at this stage. We'll start with a thorough ear cleaning today. I'd like to dispense a medicated ear ointment, a combination of an antibiotic, an antifungal and a steroid, one pump into each ear twice a day for fourteen days. Because the left ear is so painful, I'm also going to send home carprofen, 75 milligrams tablets, half a tablet every twelve hours with food for five days. Hold off the swimming until I see him again.
Owner: Okay. And the paws?
Vet: The paw licking along with recurrent ear infections makes me think there could be an underlying allergy, environmental or food. We'll talk about that at the recheck rather than today. For now, keep his ears dry and wipe them after any water exposure.
Owner: That makes sense. When should we come back?
Vet: Let's recheck in two weeks. If he gets worse, starts tilting his head, or loses balance, call us right away. We'll look at the left eardrum properly once the swelling is down. Please call if he stops eating or seems more painful.
Owner: Will do. Thank you, Dr. Patel.`,
  },
  {
    id: 'feline-wellness',
    label: 'Cat wellness + vaccines (weight loss)',
    description: 'Annual wellness, feline, with gradual weight loss',
    appointment_type: 'wellness',
    patient: { name: 'Mochi', species: 'feline', breed: 'Domestic Shorthair', age: '11 years', sex: 'Female, spayed', weight: '3.9 kg' },
    text: `Vet: Hi there, I'm Dr. Nguyen. So this is Mochi's annual exam and vaccines, right?
Owner: That's right. She's eleven now. I think she's doing okay, but I did notice she's looking a little thinner. Her spine feels bony when I pet her.
Vet: Okay, let's talk about that. How's her appetite?
Owner: She's actually eating more than ever. She's always begging for food at five in the morning. She's on a dry senior food, about a cup and a half a day, plus a few treats.
Vet: And water intake? Litter box?
Owner: She does drink more, I think. I'm filling the fountain every day, where before it was every couple of days. Urinating a lot too, the clumps are bigger. Stools are normal.
Vet: Any vomiting, coughing, sneezing?
Owner: She throws up a hairball maybe once a month, nothing different. No coughing. She's a bit more vocal at night. She's indoor only, lives with one other cat, Tofu, who's healthy.
Vet: Great, thanks. Let's check her over. Her weight today is 3.9 kilograms, which is down from 4.8 kilograms a year ago, so that's about nineteen percent weight loss. Body condition score 3 out of 9, so she's underweight. Temperature 102.4. Heart rate is 220 and she has a soft grade two systolic murmur on the left side that I don't hear in her records. Respiratory rate 32, a little elevated but she's pretty stressed. Mucous membranes are pink, capillary refill under two seconds. She's mildly dehydrated.
Vet: Abdomen is soft, no pain, no masses. I can feel a small firm nodule in the neck, in the thyroid area, on the right side. Kidneys feel small and smooth. Coat is a bit unkempt. Teeth have moderate tartar and gingivitis along the upper premolars, a grade two, no fractured teeth. Eyes and ears are normal.
Owner: Is the weight loss serious?
Vet: With her age, the increased appetite, thirst, heart rate, murmur and that thyroid nodule, I'm suspicious of hyperthyroidism. Kidney disease and diabetes are also possible, so we need bloodwork. I'd recommend a full blood panel with a total T4, a urinalysis, and a blood pressure measurement today. If the thyroid is high, we'll talk treatment options. We may also consider an echocardiogram given the murmur.
Owner: Okay, let's do the bloodwork. What about her vaccines?
Vet: Her FVRCP and rabies are due. Because she's indoor only, I'd give the FVRCP every three years and the rabies vaccine, a one-year product. Given that she may be unwell, I'd prefer to give the rabies today and hold the FVRCP until we have results. I'll give the rabies in the right hind leg. She did great, no reaction. Her heartworm and flea prevention, are you giving that monthly?
Owner: I've been a bit inconsistent honestly, since she's indoors.
Vet: I'd recommend a monthly preventive anyway. I'll prescribe it. I'll call you with results tomorrow, and we'll schedule dental cleaning after her health is sorted out.`,
  },
  {
    id: 'canine-dental',
    label: 'Dog pre-dental (COHAT) discussion',
    description: 'Dental consult, canine, anaesthesia and extraction consent',
    appointment_type: 'dental',
    patient: { name: 'Pepper', species: 'canine', breed: 'Miniature Schnauzer', age: '9 years', sex: 'Female, spayed', weight: '8.6 kg' },
    text: `Vet: Hello, I'm Dr. Alvarez. You're here for Pepper's dental consult, is that right?
Owner: Yes. Her breath has gotten really bad over the last few months. And she's been chewing on one side, dropping her kibble sometimes. My groomer said she has a loose tooth.
Vet: Okay, thank you. Any bleeding from the mouth, swelling on her face, or sneezing?
Owner: Some blood on her chew toy last week. No facial swelling. She's still eating, just slower, and she doesn't want hard treats anymore.
Vet: How old is she again, and any health problems?
Owner: She's nine. She had pancreatitis about three years ago, so she's on a low-fat food. Otherwise healthy. No medications except her monthly heartworm and flea chew. She had anesthesia when she was spayed and did fine.
Vet: Good. Let me look at her mouth while she's awake. She is a bit anxious, so I'll be quick. Heavy calculus on all the premolars and molars, gingival inflammation, grade three on the upper left side. The upper left fourth premolar is mobile and there's gingival recession with pus at the margin. The lower right first molar looks to be fractured. I'd estimate stage three periodontal disease, possibly stage four on a couple of teeth, but we need dental radiographs under anesthesia to confirm. Her weight is 8.6 kilograms, heart rate 112, regular, no murmur, lungs clear. Temperature 101.3.
Owner: So does she need a cleaning?
Vet: Yes, a full cleaning, which we call a COHAT, a comprehensive oral health assessment and treatment. Under general anesthesia we'd take full-mouth dental radiographs, probe every tooth, scale and polish, and then we decide about extractions. Based on what I see I expect we'll need to extract the upper left fourth premolar and probably the fractured lower right molar. I'd like to do pre-anesthetic blood work and a urinalysis first, given her age and the pancreatitis history. Because of her pancreatitis, we'll keep the fasting window as short as possible and use IV fluids throughout.
Owner: What does it cost?
Vet: I'll give you a written estimate. The base dental is about eight hundred dollars, and extractions add between one hundred and fifty and four hundred dollars each, depending on difficulty. Local nerve blocks are included so she'll have good pain control, and she'll go home with pain medication and possibly antibiotics if there's infection on the radiographs. Do I have your consent to extract teeth if we find them necessary?
Owner: Yes, if it's needed, do what's best for her. Please call me if anything unexpected comes up.
Vet: Absolutely. No food after ten tonight, water is fine until the morning. Drop her off at eight. After the procedure she'll need soft food for ten to fourteen days, and we'll recheck in two weeks. Long term we'll talk about daily tooth brushing and a dental diet.
Owner: Great, we'll book it for next Tuesday.`,
  },
];
